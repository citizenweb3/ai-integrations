import { FC, PropsWithChildren } from "react";
import { twMerge } from "tailwind-merge";

interface OwnProps {
  className?: string;
  // Optional anchor id so the campaign detail "next action" CTAs can scroll
  // the operator directly to the relevant section (T-026AD stage strip).
  id?: string | undefined;
}

const Card: FC<PropsWithChildren<OwnProps>> = ({ className, children, id }) => {
  return (
    <div
      id={id}
      className={twMerge(
        "min-h-32 group rounded-2xl bg-white/5 p-8 shadow-[0_18px_60px_rgba(0,0,0,0.35)] scroll-mt-8",
        className
      )}
    >
      {children}
    </div>
  );
};

export default Card;
