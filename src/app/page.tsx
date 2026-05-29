import Hero from '@/components/hero';
import SiteFooter from '@/components/footer';
import ScrollToTop from '@/components/scroll-to-top';
import BeforeAfter from '@/components/before-after';
import AgentsFirstClient from '@/components/agents-first-client';
import AiWorkforce from '@/components/ai-workforce';
import OurOpenSourceExamples from '@/components/our-open-source-examples';
import AgentsService from '@/components/agents-service';
import ComparisonTable from '@/components/comparison-table';
import AutomationCases from '@/components/automation-cases';
import Pricing from '@/components/pricing';

export default function Page() {
  return (
    <div className="min-h-dvh bg-[hsl(var(--background))]">
      <main>
        <Hero
          variant="home"
          title="AI Agents as a Service: Tailored Automation for Your Business"
          subtitle="We don't build chatbots. We build entire autonomous AI workforces."
        />
        <AgentsService />
        <ComparisonTable />
        <AutomationCases />
        <BeforeAfter />
        <AiWorkforce />
        <OurOpenSourceExamples />
        <Pricing />
      </main>
      <SiteFooter />
      <ScrollToTop />
    </div>
  );
}
