import type { ReactNode } from "react";

import styles from "../TestPrint.module.css";

interface BodyContainerProps {
  children: ReactNode;
}

export function BodyContainer({ children }: BodyContainerProps) {
  return <div className={styles.problemList}>{children}</div>;
}
