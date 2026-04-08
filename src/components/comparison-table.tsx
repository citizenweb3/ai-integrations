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
      { short: 'Full ownership', full: 'Runs on your infrastructure, your data never leaves your servers. You control access, encryption, and retention. Local LLM integration available for full air-gapped isolation.', rating: 'good' },
      { short: 'Your responsibility', full: 'Full ownership if you deploy yourself. But you build and secure everything from scratch.', rating: 'good' },
      { short: 'Their cloud', full: 'Conversations and data stored on provider servers. Subject to their privacy policy and jurisdiction.', rating: 'bad' },
      { short: 'Code local, prompts remote', full: 'Code stays local, but prompts and context are sent to provider API for processing.', rating: 'medium' },
      { short: 'Provider hosts', full: 'Provider hosts your agents and data. Subject to their terms and data processing policies.', rating: 'bad' },
      { short: 'Mixed', full: 'Workflows run on their cloud, data passes through their servers. Some offer self-hosted options (n8n) but with limited AI capabilities.', rating: 'medium' },
    ],
  },
  {
    label: 'Time to Production',
    cells: [
      { short: 'Days to weeks', full: 'We handle architecture, deployment, and integration. You describe what you need, we deliver working agents.', rating: 'good' },
      { short: 'Months', full: 'You need a dev team to design, build, test, and deploy. Every integration is custom code.', rating: 'bad' },
      { short: 'Instant for chat', full: 'Instant for chat use cases. But there are no autonomous agents — a human must be in the loop at all times.', rating: 'medium' },
      { short: 'Hours for code tasks', full: 'Hours for code generation and fixes. Not designed for business workflow automation.', rating: 'medium' },
      { short: 'Days to weeks', full: 'Days to weeks within platform capabilities. Longer when you hit platform limits and need workarounds.', rating: 'medium' },
      { short: 'Hours for basics', full: 'Hours for basic automations. Breaks down when you need custom logic, complex chains, or domain-specific behavior.', rating: 'medium' },
    ],
  },
  {
    label: 'Total Cost',
    cells: [
      { short: 'Predictable', full: 'Project-based pricing. Infrastructure costs are predictable — your servers, your LLM keys. No per-seat fees, no usage surprises.', rating: 'good' },
      { short: 'Team cost high', full: 'Low framework cost (open-source), but high team cost. You pay for developers to build, maintain, and debug. The framework is free, the engineering is not.', rating: 'bad' },
      { short: '$20–200/user/mo', full: 'Per-seat subscriptions. Scales with number of users, not with business value delivered.', rating: 'medium' },
      { short: 'Per-seat or per-token', full: 'Per-seat or per-token pricing. Scales with dev team size and usage volume.', rating: 'medium' },
      { short: 'Per-agent pricing', full: 'Per-agent or per-run pricing that grows with usage. Enterprise tiers for serious features.', rating: 'medium' },
      { short: 'Compounds', full: 'Free or low entry. Paid tiers for volume, premium nodes, and AI steps. Costs compound when you chain multiple services together.', rating: 'medium' },
    ],
  },
  {
    label: 'Customization',
    cells: [
      { short: 'Unlimited', full: 'Agents built for your specific domain, data, and workflows. Custom tools, custom models, custom integrations. No platform constraints.', rating: 'good' },
      { short: 'Unlimited (DIY)', full: 'You can build anything, but you build everything. Every custom feature is engineering time.', rating: 'good' },
      { short: 'Minimal', full: 'Limited to prompt tuning and plugin selection. No way to build custom agent logic or domain-specific workflows.', rating: 'bad' },
      { short: 'Deep for code only', full: 'Deep customization for code tasks. Limited outside IDE context — not for business process automation.', rating: 'medium' },
      { short: 'Medium', full: 'Within platform templates and tools. Works for supported patterns, painful when you need something they didn\'t anticipate.', rating: 'medium' },
      { short: 'Shallow', full: 'Pre-built nodes and templates. When your use case doesn\'t fit existing blocks, you\'re stuck or writing custom code anyway.', rating: 'bad' },
    ],
  },
  {
    label: 'Maintenance',
    cells: [
      { short: 'We handle it', full: 'Agent updates, model migrations, infrastructure monitoring, incident response. You focus on your business.', rating: 'good' },
      { short: 'All on you', full: 'Framework updates break things, LLM API changes need code fixes, scaling issues need DevOps. Your team owns every layer.', rating: 'bad' },
      { short: 'Nothing to maintain', full: 'Provider maintains everything. But there are no agents to manage — it\'s a chat tool, not an automation platform.', rating: 'good' },
      { short: 'You manage context', full: 'Provider handles the model. You maintain prompts, project context, and CLAUDE.md configurations.', rating: 'medium' },
      { short: 'Agent logic is yours', full: 'Platform maintains infrastructure. Agent logic, prompt engineering, and debugging are your responsibility.', rating: 'medium' },
      { short: 'Complex = pain', full: 'Platform maintains itself, but when an automation breaks at 2AM you\'re reading docs alone. Complex chains are hard to debug with visual tools.', rating: 'medium' },
    ],
  },
  {
    label: 'Integration',
    cells: [
      { short: 'Direct access', full: 'Agents connect to your databases, APIs, and internal tools through MCP and custom connectors. We build the bridge.', rating: 'good' },
      { short: 'Code it all', full: 'Full access if you code it. Every integration is a custom development project. Powerful but time-consuming.', rating: 'medium' },
      { short: 'Chat plugins only', full: 'Limited to chat plugins. No deep access to your databases, APIs, or internal business systems.', rating: 'bad' },
      { short: 'IDE and codebase', full: 'Integrates with IDE and codebase. No access to business systems, CRMs, or operational databases.', rating: 'bad' },
      { short: 'Plugin marketplace', full: 'Through platform marketplace. Wide selection for popular services, gaps for niche or internal tools.', rating: 'medium' },
      { short: 'SaaS connectors', full: 'Hundreds of pre-built connectors for SaaS products. Weak for custom APIs, internal databases, or anything not in their marketplace.', rating: 'medium' },
    ],
  },
  {
    label: 'Scalability',
    cells: [
      { short: 'No vendor caps', full: 'Scales with your infrastructure. Add agents, add servers. No vendor bottlenecks, no usage caps. CI/CD pipeline handles deployment automatically.', rating: 'good' },
      { short: 'If engineered', full: 'Scales if you engineer it. You design the architecture, manage containers, handle load balancing. No limits except your team\'s capacity.', rating: 'medium' },
      { short: 'Scales users, not agents', full: 'Scales the number of users, not autonomous agents. No autonomous scaling — a human drives every interaction.', rating: 'bad' },
      { short: 'One dev = one agent', full: 'One developer equals one agent session. Doesn\'t multiply into autonomous workforce.', rating: 'bad' },
      { short: 'Easy but costly', full: 'Scales easily within platform limits. But costs grow linearly, and enterprise tiers gate critical features.', rating: 'medium' },
      { short: 'Limited', full: 'Struggles beyond basic workflows. Complex multi-agent systems don\'t fit the visual builder paradigm.', rating: 'bad' },
    ],
  },
  {
    label: 'Behavior Predictability',
    cells: [
      { short: 'Deterministic', full: 'Agents grounded in your verified data through RAG — they use real facts, not hallucinations. Custom guardrails, evaluation pipelines, and domain-specific constraints ensure consistent, trustworthy output.', rating: 'good' },
      { short: 'Depends on engineering', full: 'You define the guardrails, you test the edge cases. Predictability is proportional to your team\'s investment in testing and constraints.', rating: 'medium' },
      { short: 'Unpredictable', full: 'General-purpose model with no business-specific constraints. Output varies between sessions. No way to enforce deterministic behavior for critical workflows.', rating: 'bad' },
      { short: 'Predictable for code', full: 'Predictable for code generation tasks. Unpredictable for anything outside IDE context — not designed for business process guarantees.', rating: 'medium' },
      { short: 'No guarantees', full: 'Generic agent runtime with no domain-specific constraints. Personality configuration is not the same as behavior boundaries. No built-in evaluation or determinism for business-critical tasks.', rating: 'bad' },
      { short: 'Rule-based parts only', full: 'Rule-based workflow steps are predictable. AI-powered steps are black boxes with no domain tuning or behavior guarantees.', rating: 'medium' },
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
