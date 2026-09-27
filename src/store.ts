import type { CaseRecord, EvidenceEntry, HypothesisVersion, Stance, TransferRecord } from "./types";

/** 相反事实达到该数量后，当前假设不能直接确认 */
export const CONTRADICT_LIMIT = 2;

export const COUNSELORS = ["林咨询师", "周咨询师", "吴咨询师"];

export const STORAGE_KEY = "hxwl12.evidence-board.v1";

let idSeq = 0;
export function uid(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSeq}`;
}

export function currentVersion(record: CaseRecord): HypothesisVersion {
  return record.versions[record.versions.length - 1];
}

export function stanceCount(record: CaseRecord, versionId: string, stance: Stance): number {
  return record.evidence.filter((entry) => entry.versionId === versionId && entry.stance === stance).length;
}

/** 当前版本的相反事实是否已达上限 */
export function isBlocked(record: CaseRecord): boolean {
  return stanceCount(record, currentVersion(record).id, "contradict") >= CONTRADICT_LIMIT;
}

export type VersionStatus = "testing" | "confirmed" | "blocked" | "history";

/** 状态由数据推导，不落库，保证重开后界面与数据一致 */
export function versionStatus(record: CaseRecord, version: HypothesisVersion): VersionStatus {
  if (version.id !== currentVersion(record).id) return "history";
  if (stanceCount(record, version.id, "contradict") >= CONTRADICT_LIMIT) return "blocked";
  if (version.confirmedBy) return "confirmed";
  return "testing";
}

export const VERSION_STATUS_TEXT: Record<VersionStatus, string> = {
  testing: "当前版本 · 验证中",
  confirmed: "当前版本 · 已确认",
  blocked: "当前版本 · 待修订",
  history: "历史版本 · 只读",
};

/**
 * 重开（重新加载）后的结构一致性核对：
 * 版本号连续、证据都指向存在的版本、转介链与当前负责人对齐。
 */
export function auditCase(record: CaseRecord): string[] {
  const issues: string[] = [];
  if (record.versions.length === 0) {
    issues.push("缺少假设版本");
    return issues;
  }
  record.versions.forEach((version, index) => {
    if (version.version !== index + 1) {
      issues.push(`版本号不连续：第 ${index + 1} 位记录为 v${version.version}`);
    }
  });
  const versionIds = new Set(record.versions.map((v) => v.id));
  record.evidence.forEach((entry) => {
    if (!versionIds.has(entry.versionId)) {
      issues.push(`证据「${entry.fact.slice(0, 12)}…」指向不存在的假设版本`);
    }
  });
  record.transfers.forEach((transfer, index) => {
    if (index > 0 && transfer.from !== record.transfers[index - 1].to) {
      issues.push("转介链条断裂：接手人与上一任负责人不一致");
    }
  });
  const lastTransfer = record.transfers[record.transfers.length - 1];
  if (lastTransfer && lastTransfer.to !== record.owner) {
    issues.push("当前负责人与最后一次转介记录不一致");
  }
  return issues;
}

export type CaseAction =
  | { type: "ADD_EVIDENCE"; caseId: string; entry: EvidenceEntry }
  | { type: "REVISE_HYPOTHESIS"; caseId: string; version: HypothesisVersion }
  | { type: "CONFIRM_HYPOTHESIS"; caseId: string; by: string; at: string }
  | { type: "TRANSFER_CASE"; caseId: string; transfer: TransferRecord };

/**
 * 所有动作都是追加式：证据只增、版本只增、转介只增。
 * 不存在修改/删除历史记录的入口，因此接手人（以及任何人）都无法改写前任记录。
 */
export function casesReducer(state: CaseRecord[], action: CaseAction): CaseRecord[] {
  switch (action.type) {
    case "ADD_EVIDENCE":
      return state.map((record) => {
        if (record.id !== action.caseId) return record;
        if (action.entry.author !== record.owner) return record; // 仅当前负责人可登记
        return { ...record, evidence: [...record.evidence, action.entry] };
      });
    case "REVISE_HYPOTHESIS":
      return state.map((record) => {
        if (record.id !== action.caseId) return record;
        if (action.version.createdBy !== record.owner) return record;
        if (!action.version.revisionReason?.trim()) return record; // 修订原因必填
        return { ...record, versions: [...record.versions, action.version] };
      });
    case "CONFIRM_HYPOTHESIS":
      return state.map((record) => {
        if (record.id !== action.caseId) return record;
        if (action.by !== record.owner) return record;
        if (isBlocked(record)) return record; // 相反事实达上限，禁止直接确认
        const current = currentVersion(record);
        return {
          ...record,
          versions: record.versions.map((v) =>
            v.id === current.id ? { ...v, confirmedBy: action.by, confirmedAt: action.at } : v
          ),
        };
      });
    case "TRANSFER_CASE":
      return state.map((record) => {
        if (record.id !== action.caseId) return record;
        if (action.transfer.to === record.owner) return record;
        return {
          ...record,
          owner: action.transfer.to,
          transfers: [...record.transfers, action.transfer],
        };
      });
    default:
      return state;
  }
}

export function loadCases(): CaseRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedCases();
    const parsed = JSON.parse(raw) as CaseRecord[];
    if (!Array.isArray(parsed) || parsed.length === 0) return seedCases();
    return parsed;
  } catch {
    return seedCases();
  }
}

export function seedCases(): CaseRecord[] {
  return [
    {
      id: "case-c042",
      clientCode: "C-042",
      topic: "焦虑",
      owner: "林咨询师",
      openedAt: "2026-09-01T10:00:00+08:00",
      versions: [
        {
          id: "c042-v1",
          version: 1,
          hypothesis: "焦虑发作由职场绩效评价触发，灾难化思维维持症状。",
          rationale: "初始访谈：三次惊恐样发作均出现在周报截止前夜；SAS 粗分 58。",
          revisionReason: null,
          createdBy: "林咨询师",
          createdAt: "2026-09-01T10:00:00+08:00",
          confirmedBy: null,
          confirmedAt: null,
        },
      ],
      evidence: [
        {
          id: "c042-e1",
          versionId: "c042-v1",
          stance: "support",
          fact: "汇报前心率升高、反复预演被否定的场景，与绩效触发假设一致。",
          sessionDate: "2026-09-08",
          author: "林咨询师",
          createdAt: "2026-09-08T21:00:00+08:00",
        },
        {
          id: "c042-e2",
          versionId: "c042-v1",
          stance: "support",
          fact: "完成一周呼吸放松练习，睡前反刍由约 1 小时缩短至 20 分钟。",
          sessionDate: "2026-09-15",
          author: "林咨询师",
          createdAt: "2026-09-15T21:00:00+08:00",
        },
        {
          id: "c042-e3",
          versionId: "c042-v1",
          stance: "contradict",
          fact: "周末家庭聚餐时同样出现心悸，当时没有任何工作任务。",
          sessionDate: "2026-09-22",
          author: "林咨询师",
          createdAt: "2026-09-22T21:00:00+08:00",
        },
      ],
      transfers: [],
    },
    {
      id: "case-c119",
      clientCode: "C-119",
      topic: "亲密关系",
      owner: "林咨询师",
      openedAt: "2026-08-20T10:00:00+08:00",
      versions: [
        {
          id: "c119-v1",
          version: 1,
          hypothesis: "亲密关系中的回避行为源于童年照料者长期缺席。",
          rationale: "初始访谈：父母长期在外，由祖辈轮流照看；恋爱中习惯回避冲突。",
          revisionReason: null,
          createdBy: "吴咨询师",
          createdAt: "2026-08-20T10:00:00+08:00",
          confirmedBy: null,
          confirmedAt: null,
        },
        {
          id: "c119-v2",
          version: 2,
          hypothesis: "回避模式由早期依恋经历与成年分手创伤共同维持，需分线工作。",
          rationale: "被前任突然分手后回避明显加重，时间线清晰；来访者自述小学前与母亲关系亲密。",
          revisionReason: "两条相反事实显示回避加重与成年分手经历直接相关，单一的童年缺席假设解释力不足。",
          createdBy: "吴咨询师",
          createdAt: "2026-09-09T10:00:00+08:00",
          confirmedBy: null,
          confirmedAt: null,
        },
      ],
      evidence: [
        {
          id: "c119-e1",
          versionId: "c119-v1",
          stance: "support",
          fact: "谈及与伴侣争执时，来访者描述与童年相似的“躲开、等风平浪静”画面。",
          sessionDate: "2026-08-27",
          author: "吴咨询师",
          createdAt: "2026-08-27T21:00:00+08:00",
        },
        {
          id: "c119-e2",
          versionId: "c119-v1",
          stance: "contradict",
          fact: "来访者回忆小学前与母亲关系亲密，回避主要集中在近两段恋爱中。",
          sessionDate: "2026-09-03",
          author: "吴咨询师",
          createdAt: "2026-09-03T21:00:00+08:00",
        },
        {
          id: "c119-e3",
          versionId: "c119-v1",
          stance: "contradict",
          fact: "来访者补充两年前被前任突然分手的经历，此后回避行为明显加重。",
          sessionDate: "2026-09-08",
          author: "吴咨询师",
          createdAt: "2026-09-08T21:00:00+08:00",
        },
        {
          id: "c119-e4",
          versionId: "c119-v2",
          stance: "support",
          fact: "以分手事件为中心的会谈中，来访者首次主动描述被抛弃感，方向与修订后假设一致。",
          sessionDate: "2026-09-17",
          author: "林咨询师",
          createdAt: "2026-09-17T21:00:00+08:00",
        },
      ],
      transfers: [
        {
          id: "c119-t1",
          from: "吴咨询师",
          to: "林咨询师",
          note: "吴咨询师离职，个案转介；历史假设与证据只读，接手人仅可追加。",
          at: "2026-09-10T09:00:00+08:00",
        },
      ],
    },
    {
      id: "case-c203",
      clientCode: "C-203",
      topic: "职业压力",
      owner: "周咨询师",
      openedAt: "2026-08-30T10:00:00+08:00",
      versions: [
        {
          id: "c203-v1",
          version: 1,
          hypothesis: "职业倦怠源于边界不清，无法拒绝额外任务。",
          rationale: "首次会谈：连续三周周末加班，自述“不会说不”。",
          revisionReason: null,
          createdBy: "周咨询师",
          createdAt: "2026-08-30T10:00:00+08:00",
          confirmedBy: null,
          confirmedAt: null,
        },
      ],
      evidence: [
        {
          id: "c203-e1",
          versionId: "c203-v1",
          stance: "support",
          fact: "本周再次替同事值班，事后明显懊悔。",
          sessionDate: "2026-09-05",
          author: "周咨询师",
          createdAt: "2026-09-05T21:00:00+08:00",
        },
        {
          id: "c203-e2",
          versionId: "c203-v1",
          stance: "contradict",
          fact: "来访者成功拒绝了一次额外任务，但疲惫与焦虑并未减轻。",
          sessionDate: "2026-09-12",
          author: "周咨询师",
          createdAt: "2026-09-12T21:00:00+08:00",
        },
        {
          id: "c203-e3",
          versionId: "c203-v1",
          stance: "contradict",
          fact: "来访者自述主要痛苦来自照顾患病母亲，工作负荷并非主因。",
          sessionDate: "2026-09-19",
          author: "周咨询师",
          createdAt: "2026-09-19T21:00:00+08:00",
        },
      ],
      transfers: [],
    },
  ];
}
