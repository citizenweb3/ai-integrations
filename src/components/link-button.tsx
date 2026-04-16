import { FC } from 'react';
import Link from 'next/link';
import Image from 'next/image';

interface OwnProps {
  buttonText?: string;
  targetLink?: string;
}

const LinkButton: FC<OwnProps> = ({ buttonText = 'Quote', targetLink = 'https://t.me/citizenweb3' }) => {
  const wideBtnClass =
    'hover:no-underline relative py-3 px-8 text-base md:py-4 md:px-14 font-bold inline-block md:text-xl text-center bg-[#1A1A1B] rounded-[9px] hover:bg-[#ffffff]/15 cursor-pointer';

  return (
    <div className="flex justify-end mt-16">
      <Link href={targetLink} target="_blank" rel="noopener noreferrer" className={wideBtnClass}>
        <Image src="/arrow.svg" alt="arrow" width={12} height={12} className="absolute top-3 right-3 w-3 h-auto" />
        {buttonText}
      </Link>
    </div>
  );
};

export default LinkButton;
