export type Stance = "support" | "contradict";

/** 会谈后登记的事实，只增不改，归属登记时的当前假设版本 */
export interface EvidenceEntry {
  id: string;
  versionId: string;
  stance: Stance;
  fact: string;
  sessionDate: string; // 会谈日期 YYYY-MM-DD
  author: string;
  createdAt: string;
}

/** 假设版本：首版修订原因为 null，旧版本永不删除 */
export interface HypothesisVersion {
  id: string;
  version: number;
  hypothesis: string;
  rationale: string; // 判断依据
  revisionReason: string | null; // 修订原因（首版为 null）
  createdBy: string;
  createdAt: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
}

export interface TransferRecord {
  id: string;
  from: string;
  to: string;
  note: string;
  at: string;
}

export interface CaseRecord {
  id: string;
  clientCode: string;
  topic: string;
  owner: string; // 当前负责咨询师，转介后更新
  openedAt: string;
  versions: HypothesisVersion[];
  evidence: EvidenceEntry[];
  transfers: TransferRecord[];
}
