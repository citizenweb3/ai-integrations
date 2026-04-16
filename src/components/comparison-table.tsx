'use client';

import { FC, useState } from 'react';
import { twMerge } from 'tailwind-merge';
import { Info } from 'lucide-react';

interface ColumnDef {
  title: string;
  subtitle: string;
  highlighted?: boolean;
}

type CellRating = 'good' | 'medium' | 'bad';

interface CellData {
  short: string;
  full: string;
  rating: CellRating;
}

interface RowDef {
  label: string;
  cells: CellData[];
}

const columns: ColumnDef[] = [
  { title: 'Our Agent Factory', subtitle: 'Self-hosted platform + services', highlighted: true },
  { title: 'DIY Frameworks', subtitle: 'CrewAI, LangGraph, AutoGen, OpenAI SDK' },
  { title: 'Cloud Assistants', subtitle: 'Claude Cowork, ChatGPT, Gemini' },
  { title: 'Coding Agents', subtitle: 'Claude Code, Codex, Cursor' },
  { title: 'Agent Platforms', subtitle: 'OpenClaw, Relevance AI' },
  { title: 'No-Code Tools', subtitle: 'n8n, Dify, Make, Zapier' },
];

const rows: RowDef[] = [
  {
    label: 'Data Control',
    cells: [
      { short: 'Full ownership', full: 'Full ownership. Runs on your infrastructure. Data never leaves your servers. Local LLMs for air-gapped isolation.', rating: 'good' },
      { short: 'Your responsibility', full: 'Full ownership if self-deployed — you build and secure everything.', rating: 'good' },
      { short: 'Their cloud', full: 'Stored on provider servers per their privacy policy.', rating: 'bad' },
      { short: 'Code local, prompts remote', full: 'Code local, but prompts sent to provider API.', rating: 'medium' },
      { short: 'Provider hosts', full: 'Provider hosts agents and data per their policies.', rating: 'bad' },
      { short: 'Mixed', full: 'Runs on their cloud; data passes through their servers (limited self-hosted options).', rating: 'medium' },
    ],
  },
  {
    label: 'Time to Production',
    cells: [
      { short: 'Days to weeks', full: 'We handle architecture, deployment, and integration. You describe it — we deliver working agents in days/weeks.', rating: 'good' },
      { short: 'Months', full: 'Months. Requires full dev team for design, build, test, and custom code.', rating: 'bad' },
      { short: 'Instant for chat', full: 'Instant for chat only — no autonomous agents, human always in loop.', rating: 'medium' },
      { short: 'Hours for code tasks', full: 'Hours for code tasks only — not for business workflows.', rating: 'medium' },
      { short: 'Days to weeks', full: 'Days to weeks within limits; longer for workarounds.', rating: 'medium' },
      { short: 'Hours for basics', full: 'Hours for basics — breaks on custom logic or complex chains.', rating: 'medium' },
    ],
  },
  {
    label: 'Total Cost',
    cells: [
      { short: 'Predictable', full: 'Predictable. Project-based + your servers/LLM keys. No per-seat or usage surprises.', rating: 'good' },
      { short: 'Team cost high', full: 'Free frameworks, but high dev team costs to build, maintain, and debug.', rating: 'bad' },
      { short: '$20–200/user/mo', full: 'Per-seat subscriptions — scales with users, not value.', rating: 'medium' },
      { short: 'Per-seat or per-token', full: 'Per-seat or per-token — scales with team and usage.', rating: 'medium' },
      { short: 'Per-agent pricing', full: 'Per-agent or per-run pricing that grows with usage.', rating: 'medium' },
      { short: 'Compounds', full: 'Low entry, but compounds with volume, premium features, and chained services.', rating: 'medium' },
    ],
  },
  {
    label: 'Customization',
    cells: [
      { short: 'Unlimited', full: 'Unlimited. Built for your exact domain, data, and workflows. Custom tools, models, integrations. No constraints.', rating: 'good' },
      { short: 'Unlimited (DIY)', full: 'Unlimited, but every feature requires engineering time.', rating: 'good' },
      { short: 'Minimal', full: 'Limited to prompt tuning and plugins — no custom agent logic.', rating: 'bad' },
      { short: 'Deep for code only', full: 'Deep for code tasks only — not for business processes.', rating: 'medium' },
      { short: 'Medium', full: 'Within platform templates; painful for unsupported patterns.', rating: 'medium' },
      { short: 'Shallow', full: 'Pre-built nodes/templates — stuck or needs custom code when it doesn\'t fit.', rating: 'bad' },
    ],
  },
  {
    label: 'Maintenance',
    cells: [
      { short: 'We handle it', full: 'We handle updates, model migrations, monitoring, and incidents. You focus on business.', rating: 'good' },
      { short: 'All on you', full: 'All on you: framework updates, API changes, scaling, DevOps.', rating: 'bad' },
      { short: 'Nothing to maintain', full: 'Provider maintains everything — but it\'s just chat, no agents.', rating: 'good' },
      { short: 'You manage context', full: 'Provider handles model; you maintain prompts and context.', rating: 'medium' },
      { short: 'Agent logic is yours', full: 'Platform maintains infra; you handle logic, prompts, and debugging.', rating: 'medium' },
      { short: 'Complex = pain', full: 'Platform maintains itself — you debug complex chains alone.', rating: 'medium' },
    ],
  },
  {
    label: 'Integration',
    cells: [
      { short: 'Direct access', full: 'Direct access to your databases, APIs, and internal tools via MCP and custom connectors. We build it.', rating: 'good' },
      { short: 'Code it all', full: 'Full access if you code every integration from scratch.', rating: 'medium' },
      { short: 'Chat plugins only', full: 'Limited to chat plugins — no deep business system access.', rating: 'bad' },
      { short: 'IDE and codebase', full: 'IDE and codebase only — no access to CRMs or operational systems.', rating: 'bad' },
      { short: 'Plugin marketplace', full: 'Marketplace plugins — good for popular services, gaps for internal tools.', rating: 'medium' },
      { short: 'SaaS connectors', full: 'Hundreds of SaaS connectors — weak for custom APIs or internal databases.', rating: 'medium' },
    ],
  },
  {
    label: 'Scalability',
    cells: [
      { short: 'No vendor caps', full: 'Scales with your infrastructure. Add agents/servers. No vendor caps or limits. Auto CI/CD.', rating: 'good' },
      { short: 'If engineered', full: 'Scales if you engineer it — limited by your team\'s capacity.', rating: 'medium' },
      { short: 'Scales users, not agents', full: 'Scales users, not autonomous agents. Human-driven only.', rating: 'bad' },
      { short: 'One dev = one agent', full: 'One dev = one agent session. No workforce scaling.', rating: 'bad' },
      { short: 'Easy but costly', full: 'Easy within platform limits, but costs grow and enterprise features are gated.', rating: 'medium' },
      { short: 'Limited', full: 'Struggles beyond basic workflows; complex multi-agent systems don\'t fit.', rating: 'bad' },
    ],
  },
  {
    label: 'Behavior Predictability',
    cells: [
      { short: 'Deterministic', full: 'Deterministic. Built with guardrails, evaluations, and domain constraints for consistent results.', rating: 'good' },
      { short: 'Depends on engineering', full: 'Depends on your team\'s testing and constraints.', rating: 'medium' },
      { short: 'Unpredictable', full: 'Unpredictable. No business constraints — output varies.', rating: 'bad' },
      { short: 'Predictable for code', full: 'Predictable for code only — not for business processes.', rating: 'medium' },
      { short: 'No guarantees', full: 'Generic runtime. No domain constraints or built-in evaluation.', rating: 'bad' },
      { short: 'Rule-based parts only', full: 'Rule-based steps are predictable; AI steps are black boxes with no guarantees.', rating: 'medium' },
    ],
  },
];

const ratingStyles: Record<CellRating, { cell: string; text: string; mobileBorder: string }> = {
  good: {
    cell: 'bg-[#2FFBF7]/[0.06]',
    text: 'text-[#2FFBF7]',
    mobileBorder: 'border-[#2FFBF7]/25',
  },
  medium: {
    cell: '',
    text: 'text-[hsl(220,10%,66%)]',
    mobileBorder: 'border-white/5',
  },
  bad: {
    cell: 'bg-[#FF6B6B]/[0.04]',
    text: 'text-[hsl(220,10%,64%)]',
    mobileBorder: 'border-[#FF6B6B]/15',
  },
};

const Tooltip: FC<{ text: string; align?: 'center' | 'right' | 'left'; direction?: 'up' | 'down' }> = ({ text, align = 'center', direction = 'up' }) => {
  const [visible, setVisible] = useState(false);

  const positionClass = align === 'right'
    ? 'right-0'
    : align === 'left'
      ? 'left-0'
      : 'left-1/2 -translate-x-1/2';

  const arrowClass = align === 'right'
    ? 'right-3'
    : align === 'left'
      ? 'left-3'
      : 'left-1/2 -translate-x-1/2';

  const verticalClass = direction === 'down' ? 'top-full mt-2' : 'bottom-full mb-2';
  const arrowVertical = direction === 'down'
    ? 'bottom-full border-b-[#0a0a0a] border-t-transparent'
    : 'top-full border-t-[#0a0a0a] border-b-transparent';

  return (
    <span className="relative inline-flex ml-1.5 align-middle">
      <button
        type="button"
        aria-label="More details"
        aria-expanded={visible}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        onClick={() => setVisible(!visible)}
        className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[hsl(220,10%,64%)] hover:text-[#2FFBF7] transition-colors cursor-help -m-3.5"
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {visible && (
        <span role="tooltip" className={twMerge('absolute z-50 w-72 rounded-lg border border-white/10 bg-[#0a0a0a] px-3 py-2.5 text-xs font-light leading-relaxed text-[#E6E6E6] shadow-xl text-left', verticalClass, positionClass)}>
          {text}
          <span className={twMerge('absolute border-4 border-transparent', arrowVertical, arrowClass)} />
        </span>
      )}
    </span>
  );
};

const ComparisonTable: FC = () => {
  return (
    <section className="py-8 md:py-16">
      <div className="max-w-[88vw] mx-auto">
        <h2 className="text-xl md:text-2xl font-bold text-left mb-2">How We Compare</h2>
        <div className="w-full h-px bg-white/50 mb-12" />

        {/* Desktop table */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="w-[140px] p-3" />
                {columns.map((col) => (
                  <th
                    key={col.title}
                    className={twMerge(
                      'p-4 text-center border-b border-white/10',
                      col.highlighted && 'border-b-[#2FFBF7]/30',
                    )}
                  >
                    <h3 className={twMerge(
                      'text-base font-bold mb-0.5',
                      col.highlighted ? 'text-[#2FFBF7]' : 'text-[#E6E6E6]',
                    )}>
                      {col.title}
                    </h3>
                    <p className="text-xs font-light text-[hsl(220,10%,64%)]">{col.subtitle}</p>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => (
                <tr key={row.label} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                  <th scope="row" className="p-3 text-left">
                    <span className="text-sm font-semibold text-[#E6E6E6]">{row.label}</span>
                  </th>
                  {row.cells.map((cell, i) => {
                    const rs = ratingStyles[cell.rating];
                    return (
                      <td
                        key={i}
                        className={twMerge(
                          'p-4 text-center text-base font-light',
                          rs.text,
                          rs.cell,
                          columns[i].highlighted && 'font-normal',
                        )}
                      >
                        {cell.short}
                        <Tooltip
                          text={cell.full}
                          align={i === 0 ? 'left' : i >= columns.length - 2 ? 'right' : 'center'}
                          direction={rowIdx === 0 ? 'down' : 'up'}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile: stacked cards */}
        <div className="flex flex-col gap-6 lg:hidden">
          {rows.map((row) => (
            <div key={row.label}>
              <div className="mb-3">
                <span className="text-sm font-semibold">{row.label}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {row.cells.map((cell, i) => {
                  const rs = ratingStyles[cell.rating];
                  return (
                    <div
                      key={i}
                      className={twMerge(
                        'rounded-lg px-3 py-2.5 text-xs font-light border',
                        rs.mobileBorder,
                        rs.cell || 'bg-white/[0.02]',
                        rs.text,
                      )}
                    >
                      <span className="block text-[11px] font-semibold uppercase tracking-wider text-[hsl(220,10%,64%)] mb-1">
                        {columns[i].title}
                      </span>
                      {cell.short}
                      <Tooltip text={cell.full} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Summary CTA */}
        <div className="mt-16 border-t border-white/10 pt-10 text-center">
          <p className="text-lg md:text-xl font-light leading-relaxed max-w-5xl mx-auto text-[hsl(220,10%,66%)]">
            Building agents from scratch takes months. Cloud platforms own your data.
            Managed agent runtimes can&apos;t guarantee how your agents behave. No-code tools break on complexity.
          </p>
          <div className="w-[166px] h-px bg-white/50 mx-auto my-6" />
          <p className="text-lg md:text-xl font-medium text-[#E6E6E6]">
            We handle the hard parts so you ship working agents in weeks.
          </p>
        </div>
      </div>
    </section>
  );
};

export default ComparisonTable;
