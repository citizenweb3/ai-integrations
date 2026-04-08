import { FC } from 'react';
import Link from 'next/link';
import Image from 'next/image';

interface OwnProps {
  buttonText?: string;
  targetLink?: string;
}

const LinkButton: FC<OwnProps> = ({ buttonText = 'Quote', targetLink = 'https://t.me/citizenweb3' }) => {
  const wideBtnClass =
    'hover:no-underline relative py-4 px-12 md:py-5 md:px-20 font-bold inline-block text-lg md:text-2xl text-center bg-[#1A1A1B] rounded-[9px] hover:bg-[#ffffff]/15 cursor-pointer';

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
