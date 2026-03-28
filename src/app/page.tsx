import Hero from '@/components/hero';
import SiteFooter from '@/components/footer';
import ScrollToTop from '@/components/scroll-to-top';
import AgentsFirstClient from '@/components/agents-first-client';
import AgentsArchitecture from '@/components/agents-architecture';
import AgentsService from '@/components/agents-service';

export default function Page() {
  return (
    <div className="min-h-dvh bg-[hsl(var(--background))]">
      <main>
        <Hero
          variant="home"
          title="AI Agents as a Service: Tailored Automation for Your Business"
          subtitle="We don't build chatbots. We build entire autonomous AI workforces."
        />
        <AgentsFirstClient />
        <AgentsArchitecture />
        <AgentsService />
      </main>
      <SiteFooter />
      <ScrollToTop />
    </div>
  );
}
