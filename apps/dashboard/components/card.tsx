import { FC, PropsWithChildren } from "react";
import { twMerge } from "tailwind-merge";

interface OwnProps {
  className?: string;
}

const Card: FC<PropsWithChildren<OwnProps>> = ({ className, children }) => {
  return (
    <div
      className={twMerge(
        "min-h-32 group rounded-2xl bg-linear-to-t from-[#7C7C81]/25 to-[#1A1A1B]/25 p-8 shadow-[0_18px_60px_rgba(0,0,0,0.35)]",
        className
      )}
    >
      {children}
    </div>
  );
};

export default Card;
