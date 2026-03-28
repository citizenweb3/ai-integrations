import { FC } from 'react';
import Image from 'next/image';
import Link from 'next/link';

const wideBtnClass =
  'hover:no-underline relative py-4 px-12 md:py-5 md:px-20 font-bold inline-block text-lg md:text-2xl text-center bg-[#1A1A1B] rounded-[9px] hover:bg-[#ffffff]/15 cursor-pointer';

const AgentsService: FC = () => {
  return (
    <section className="py-8 md:py-16">
      <div className="max-w-[80vw] mx-auto">
        <h2 className="text-xl md:text-2xl font-bold text-left mb-2">The Service</h2>
        <div className="w-full h-px bg-white/50 mb-16" />
        <p className="text-base md:text-xl font-light mb-4">Four-step process:</p>
        <ul className="list-disc pl-6 text-base md:text-xl font-light space-y-2">
          <li>Discovery & Architecture Design</li>
          <li>Custom Agent Development & Integration</li>
          <li>Deployment (self-hosted or hybrid)</li>
          <li>Ongoing management & upgrades (optional)</li>
        </ul>
        <div className="flex justify-end mt-8">
          <Link href="https://t.me/citizenweb3" target="_blank" rel="noopener noreferrer" className={wideBtnClass}>
            <Image src="/arrow.svg" alt="arrow" width={12} height={12} className="absolute top-3 right-3 w-3 h-auto" />
            Quote
          </Link>
        </div>
      </div>
    </section>
  );
};

export default AgentsService;
