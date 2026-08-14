import type { Difficulty } from "@/contracts/common.contract";

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "하",
  mid: "중",
  hard: "상",
};

export const FIELD_CLASS =
  "h-11 w-full cursor-pointer border border-[#C2C2C0] bg-white px-3 text-[12.5px] text-[#161616] focus:border-[#1A73E8] focus:outline focus:outline-2 focus:outline-offset-0 focus:outline-[#1A73E8] disabled:cursor-not-allowed";
