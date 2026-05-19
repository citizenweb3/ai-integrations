// Organization dedupe service (canonical §67). Deterministic gate that
// runs between the agentic `campaign_discovery` ADK proposal and the
// `discovery_candidates` insert: every proposal is checked against the
// existing `organizations` table and tagged with one of the four
// `DedupeResult` classes. The worker (D4) consumes the outcome to decide
// the `discovery_candidates.status` transition:
//
//   strong  → status = 'duplicate', auto-link to matched org
//   medium  → status = 'queued_for_enrichment' if exactly-one + no conflict
//             (auto-link); else status = 'needs_review'
//   weak    → status = 'needs_review'
//   none    → status = 'proposed' (new org candidate)
//
// Anti-hallucination: this service never trusts agent-emitted IDs. The
// only inputs are the candidate's `name`, `domain`, `websiteUrl`,
// `countryCode`. Matching is by canonicalized fields against existing
// org rows.
//
// MVP scaling note: medium/weak matching pulls the full `organizations`
// table into memory for in-process token comparison. Acceptable while
// |organizations| < 5k. Beyond that, precompute a `canonical_name`
// column + a token-frequency table (canonical §67 leaves the
// implementation open).

import { sql } from "drizzle-orm";
import { organizations } from "./schema";
import type { DedupeResult } from "@bizdev/shared";

// Subset of the drizzle client interface this module needs. Accepts both
// the top-level db and a transaction handle so the dedupe service can be
// called either standalone (for previews) or in-tx with the candidate
// insert (the production path).
export type DedupeDb = {
  select: (...args: never[]) => unknown;
  execute: (query: unknown) => Promise<unknown>;
};

export type DedupeCandidateInput = {
  proposedName: string;
  domain: string | null;
  websiteUrl: string | null;
  countryCode: string | null;
};

export type DedupeOutcome = {
  result: DedupeResult;
  // Set whenever there is at least one match (strong | medium | weak).
  // For multi-match medium/weak this is the *highest-confidence* match
  // (first row in `ambiguousMatches`); operator review surfaces the
  // others.
  matchedOrganizationId: string | null;
  // Whether the worker should auto-link without operator review.
  // Strong: always true. Medium: true only when exactly one match with
  // no conflicting domain. Weak: never. None: false.
  shouldAutoLink: boolean;
  // Human/audit code. One of:
  //   `domain_exact_match` | `name_match_country_match` | `name_match_only` |
  //   `name_token_overlap` | `medium_ambiguous_multi_match` |
  //   `medium_conflicting_domain` | `no_match`
  reasonCode: DedupeReasonCode;
  // Other organization ids that also matched at the same tier. Empty
  // for `none` and for unambiguous strong matches. Populated on
  // medium/weak ambiguity so the operator UI can list candidates.
  ambiguousMatches: string[];
};

export const dedupeReasonCodes = [
  "domain_exact_match",
  "name_match_country_match",
  "name_match_only",
  "name_token_overlap",
  "medium_ambiguous_multi_match",
  "medium_conflicting_domain",
  "no_match"
] as const;
export type DedupeReasonCode = (typeof dedupeReasonCodes)[number];

// =============================================================================
// Canonicalization
// =============================================================================

// Lowercase, strip protocol / www. / path / query / port / trailing dots.
// Returns null when the input is empty or cannot be reduced to a
// hostname-shaped string. Idempotent: f(f(x)) === f(x).
export function canonicalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;

  // Strip URL scheme. Match `https://`, `http://`, `mailto:`, etc.
  s = s.replace(/^[a-z][a-z0-9+\-.]*:\/\//, "");
  // Mailto-style or `user@host` — take the host part.
  const atIdx = s.lastIndexOf("@");
  if (atIdx >= 0) s = s.slice(atIdx + 1);
  // Strip path / query / fragment.
  const slashIdx = s.indexOf("/");
  if (slashIdx >= 0) s = s.slice(0, slashIdx);
  const qIdx = s.indexOf("?");
  if (qIdx >= 0) s = s.slice(0, qIdx);
  const hashIdx = s.indexOf("#");
  if (hashIdx >= 0) s = s.slice(0, hashIdx);
  // Strip port.
  const colonIdx = s.lastIndexOf(":");
  if (colonIdx >= 0) s = s.slice(0, colonIdx);
  // Strip leading www.
  s = s.replace(/^www\./, "");
  // Strip trailing dots (FQDN root marker).
  s = s.replace(/\.+$/, "");

  if (!s || !s.includes(".")) return null;
  return s;
}

// Common legal suffixes across English/EU/CIS jurisdictions. Stripped
// during name canonicalization so "Acme Inc." and "Acme Corp" collapse
// to the same canonical "acme". This list is intentionally broad —
// false-positive suffix stripping is safer than false-negative because
// canonical names are never user-facing; they only feed the dedupe
// match.
const LEGAL_SUFFIXES = new Set([
  "inc", "incorporated", "ltd", "limited", "llc", "lc", "plc",
  "corp", "corporation", "co", "company", "holdings", "group",
  "gmbh", "ag", "kg", "og", "ug", "eg",
  "sa", "sas", "sarl", "srl", "spa", "bv", "nv",
  "oy", "ab", "as", "aps", "ehf",
  "kk", "ooo", "oao", "zao", "ip",
  "pty", "llp", "lp", "pllc",
  "ehrt", "hf",
  // Cyrillic forms commonly transliterated in source data.
  "ооо", "оао", "зао", "пао"
]);

// Split words on any non-alphanumeric, lowercase, drop empties + legal
// suffixes. Stable ordering preserved (we don't sort) so two callers
// canonicalizing "Foo Bar Inc" and "Bar Foo Inc" do not collide.
export function canonicalNameTokens(input: string | null | undefined): string[] {
  if (!input) return [];
  const tokens: string[] = [];
  for (const raw of input.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!raw) continue;
    if (LEGAL_SUFFIXES.has(raw)) continue;
    tokens.push(raw);
  }
  return tokens;
}

export function canonicalizeName(input: string | null | undefined): string | null {
  const tokens = canonicalNameTokens(input);
  if (tokens.length === 0) return null;
  return tokens.join(" ");
}

// Significant tokens for the weak-match pass: drop very short tokens
// (length < 4) and a small stopword list. The threshold is empirical —
// 3-letter brand names (e.g. "IBM", "AWS") would be lost, but this
// service only fires after strong/medium have failed, where a 3-letter
// token alone is too noisy to declare even a weak match. The acronym
// case is recovered when the agent emits a domain (strong tier).
const WEAK_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "international", "global",
  "solutions", "systems", "services", "technologies", "consulting",
  "media", "digital", "labs", "studio", "studios", "ventures"
]);

function significantTokens(name: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const t of canonicalNameTokens(name)) {
    if (t.length < 4) continue;
    if (WEAK_STOPWORDS.has(t)) continue;
    out.add(t);
  }
  return out;
}

// =============================================================================
// Dedupe entry point
// =============================================================================

type OrgRow = {
  id: string;
  name: string;
  domain: string | null;
  countryCode: string | null;
};

// `db` is typed loosely so callers pass either the top-level client or
// a `tx` handle. The narrow `unknown`-cast at the call site is safer
// than reaching into drizzle's internal generics — both shapes expose
// the same `.execute(sql\`...\`)` runtime contract.
export async function dedupeOrganization(
  db: DedupeDb,
  candidate: DedupeCandidateInput
): Promise<DedupeOutcome> {
  const candidateDomain = canonicalizeDomain(candidate.domain ?? candidate.websiteUrl);
  const candidateName = canonicalizeName(candidate.proposedName);
  const candidateCountry = candidate.countryCode?.trim().toUpperCase() || null;

  // ---------- Strong: exact domain match ----------
  if (candidateDomain) {
    const strong = await fetchOrgsByDomain(db, candidateDomain);
    if (strong.length > 0) {
      // Multiple orgs on the same domain is a data-integrity oddity
      // (the existing `organizations_domain_idx` is non-unique); we
      // pick the lexicographically smallest id for determinism and
      // surface the rest as ambiguous so the operator can clean up.
      const sorted = [...strong].sort((a, b) => a.id.localeCompare(b.id));
      const primary = sorted[0]!;
      const rest = sorted.slice(1);
      return {
        result: "strong",
        matchedOrganizationId: primary.id,
        shouldAutoLink: true,
        reasonCode: "domain_exact_match",
        ambiguousMatches: rest.map((r) => r.id)
      };
    }
  }

  // No strong match; pull the full org table for in-memory medium/weak
  // matching. See header comment on scaling.
  const allOrgs = await fetchAllOrgs(db);

  // ---------- Medium: canonical name match ----------
  if (candidateName) {
    const nameMatches: OrgRow[] = [];
    for (const org of allOrgs) {
      if (canonicalizeName(org.name) === candidateName) {
        nameMatches.push(org);
      }
    }

    if (nameMatches.length > 0) {
      // Strong-tier already filtered out exact-domain matches. If the
      // candidate has a domain AND any name-matched org also has a
      // *different* domain, that's a conflicting-domain medium → no
      // auto-link, route to needs_review.
      const conflicting = candidateDomain
        ? nameMatches.filter(
            (o) => o.domain && canonicalizeDomain(o.domain) !== candidateDomain
          )
        : [];
      const hasConflict = conflicting.length > 0;

      // Country-equality narrows the medium tier per canonical §67
      // ("same name plus same country/region"). A country match alone
      // is not strong enough to auto-link without operator review.
      const countryMatches = candidateCountry
        ? nameMatches.filter((o) => o.countryCode === candidateCountry)
        : [];

      // Auto-link rule per spec: "Medium matches may auto-link only if
      // there is exactly one candidate and no conflicting domain or
      // suppression state." We don't check suppression here (that's the
      // policy gate's job in D4); only the dedupe-tier conditions.
      const autoLinkEligible =
        nameMatches.length === 1 && !hasConflict;

      const sorted = [...nameMatches].sort((a, b) => a.id.localeCompare(b.id));
      const primary = sorted[0]!;
      const rest = sorted.slice(1);
      const reasonCode: DedupeReasonCode = hasConflict
        ? "medium_conflicting_domain"
        : nameMatches.length > 1
          ? "medium_ambiguous_multi_match"
          : countryMatches.length > 0
            ? "name_match_country_match"
            : "name_match_only";

      return {
        result: "medium",
        matchedOrganizationId: primary.id,
        shouldAutoLink: autoLinkEligible,
        reasonCode,
        ambiguousMatches: rest.map((r) => r.id)
      };
    }
  }

  // ---------- Weak: significant-token overlap ----------
  if (candidateName) {
    const candidateTokens = significantTokens(candidate.proposedName);
    if (candidateTokens.size > 0) {
      const weakMatches: OrgRow[] = [];
      for (const org of allOrgs) {
        const orgTokens = significantTokens(org.name);
        if (orgTokens.size === 0) continue;
        let overlap = 0;
        for (const t of candidateTokens) {
          if (orgTokens.has(t)) {
            overlap += 1;
            if (overlap >= 1) break;
          }
        }
        if (overlap >= 1) weakMatches.push(org);
      }

      if (weakMatches.length > 0) {
        const sorted = [...weakMatches].sort((a, b) => a.id.localeCompare(b.id));
        const primary = sorted[0]!;
        const rest = sorted.slice(1);
        return {
          result: "weak",
          matchedOrganizationId: primary.id,
          shouldAutoLink: false,
          reasonCode: "name_token_overlap",
          ambiguousMatches: rest.map((r) => r.id)
        };
      }
    }
  }

  return {
    result: "none",
    matchedOrganizationId: null,
    shouldAutoLink: false,
    reasonCode: "no_match",
    ambiguousMatches: []
  };
}

// =============================================================================
// Internal queries
// =============================================================================

// Drizzle's typed `.select()` would tightly couple the query to the
// schema generics; the candidate field set we read is small and stable
// so a raw `sql` template is simpler and survives schema evolution.

type SqlExecutor = { execute: (q: unknown) => Promise<unknown> };

async function fetchOrgsByDomain(db: DedupeDb, domain: string): Promise<OrgRow[]> {
  const exec = db as unknown as SqlExecutor;
  const rows = (await exec.execute(
    sql`select id, name, domain, country_code from ${organizations} where lower(domain) = ${domain}`
  )) as Array<{ id: string; name: string; domain: string | null; country_code: string | null }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    domain: r.domain,
    countryCode: r.country_code
  }));
}

async function fetchAllOrgs(db: DedupeDb): Promise<OrgRow[]> {
  const exec = db as unknown as SqlExecutor;
  const rows = (await exec.execute(
    sql`select id, name, domain, country_code from ${organizations}`
  )) as Array<{ id: string; name: string; domain: string | null; country_code: string | null }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    domain: r.domain,
    countryCode: r.country_code
  }));
}
