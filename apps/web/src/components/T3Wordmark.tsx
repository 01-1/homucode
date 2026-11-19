import type { SVGProps } from "react";

export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 64 21" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2 2v16m0-8h11m0-8v16m5-6a5 5 0 1 0 10 0 5 5 0 1 0-10 0m15-5v11m0-7a4 4 0 0 1 8 0v7m0-7a4 4 0 0 1 8 0v7m5-11v7a4 4 0 0 0 8 0m0-7v11"
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
