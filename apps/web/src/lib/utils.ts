import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** 合并 Tailwind class，后写的同类 class 覆盖先写的。 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
