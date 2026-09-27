import { useEffect, useReducer, useState } from "react";
import type { Dispatch } from "react";
import "./styles.css";
import type { CaseRecord, EvidenceEntry, HypothesisVersion, Stance, TransferRecord } from "./types";
import {
  CONTRADICT_LIMIT,
  COUNSELORS,
  STORAGE_KEY,
  VERSION_STATUS_TEXT,
  auditCase,
  casesReducer,
  currentVersion,
  isBlocked,
  loadCases,
  stanceCount,
  uid,
  versionStatus,
} from "./store";
import type { CaseAction } from "./store";

const project = {
  id: "hxwl-12",
  port: 5112,
  title: "心理咨询个案记录",
  subtitle:
    "个案概念化升级为临床假设证据台：当前假设与判断依据在线可查，会谈后分别登记支持事实与相反事实；相反事实累计两条即冻结确认，须填写修订原因另存新版本，旧判断永久保留。",
  stack: "React + Vite + TypeScript + CSS",
};

const statusColors = ["status-ok", "status-watch", "status-danger"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function withinDays(dateStr: string, days: number): boolean {
  const t = new Date(`${dateStr}T00:00:00`).getTime();
  return Date.now() - t <= days * 86400000;
}

function MetricCard({ label, value, index }: { label: string; value: string; index: number }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <i className={statusColors[index % statusColors.length]} />
    </article>
  );
}

function EvidenceForm({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (stance: Stance, fact: string, sessionDate: string) => void;
}) {
  const [stance, setStance] = useState<Stance>("support");
  const [fact, setFact] = useState("");
  const [date, setDate] = useState(todayStr());

  const submit = () => {
    if (!fact.trim()) return;
    onAdd(stance, fact.trim(), date);
    setFact("");
  };

  return (
    <section className="evidence-form">
      <h3 className="subsection-title">会谈后登记事实（只增不改，归入当前假设版本）</h3>
      <div className="form-row">
        <div className="stance-toggle">
          <button
            type="button"
            className={stance === "support" ? "active support" : ""}
            onClick={() => setStance("support")}
          >
            支持事实
          </button>
          <button
            type="button"
            className={stance === "contradict" ? "active contradict" : ""}
            onClick={() => setStance("contradict")}
          >
            相反事实
          </button>
        </div>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="会谈日期" />
      </div>
      <textarea
        rows={3}
        value={fact}
        onChange={(e) => setFact(e.target.value)}
        placeholder="记录会谈中出现的具体事实，登记后自动挂到当前假设版本名下"
      />
      <div className="actions">
        <button className="primary-action" disabled={disabled || !fact.trim()} onClick={submit}>
          登记到证据链
        </button>
      </div>
    </section>
  );
}

function RevisionForm({
  nextVersion,
  onSubmit,
  onCancel,
}: {
  nextVersion: number;
  onSubmit: (hypothesis: string, rationale: string, revisionReason: string) => void;
  onCancel: () => void;
}) {
  const [hypothesis, setHypothesis] = useState("");
  const [rationale, setRationale] = useState("");
  const [reason, setReason] = useState("");
  const ready = Boolean(hypothesis.trim() && rationale.trim() && reason.trim());

  return (
    <section className="revise-form">
      <h3 className="subsection-title">修订并另存为 v{nextVersion}（原版本保留可查）</h3>
      <label>
        <span>修订原因（必填，说明相反事实如何动摇了原假设）</span>
        <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <label>
        <span>新假设</span>
        <textarea rows={2} value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} />
      </label>
      <label>
        <span>判断依据</span>
        <textarea rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} />
      </label>
      <div className="actions">
        <button
          className="primary-action"
          disabled={!ready}
          onClick={() => onSubmit(hypothesis.trim(), rationale.trim(), reason.trim())}
        >
          另存为新版本
        </button>
        <button type="button" onClick={onCancel}>
          取消
        </button>
      </div>
    </section>
  );
}

function TransferForm({
  record,
  onSubmit,
  onCancel,
}: {
  record: CaseRecord;
  onSubmit: (to: string, note: string) => void;
  onCancel: () => void;
}) {
  const candidates = COUNSELORS.filter((c) => c !== record.owner);
  const [to, setTo] = useState(candidates[0]);
  const [note, setNote] = useState("");

  return (
    <section className="transfer-form">
      <h3 className="subsection-title">转介个案（历史记录保持只读，接手人仅可追加证据）</h3>
      <div className="form-row">
        <label>
          <span>接手咨询师</span>
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            {candidates.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="grow">
          <span>转介说明</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="填写转介原因与交接要点" />
        </label>
      </div>
      <div className="actions">
        <button className="primary-action" disabled={!note.trim()} onClick={() => onSubmit(to, note.trim())}>
          确认转介
        </button>
        <button type="button" onClick={onCancel}>
          取消
        </button>
      </div>
    </section>
  );
}

function EvidenceCard({ entry, record }: { entry: EvidenceEntry; record: CaseRecord }) {
  const version = record.versions.find((v) => v.id === entry.versionId);
  const locked = entry.author !== record.owner;
  return (
    <article className={`evidence-card ${entry.stance}`}>
      <p>{entry.fact}</p>
      <div className="evidence-meta">
        <span>会谈 {entry.sessionDate}</span>
        <span>登记人 {entry.author}</span>
        <span>对应假设 v{version ? version.version : "?"}</span>
        {locked && <span className="locked-badge">前任记录 · 只读</span>}
      </div>
    </article>
  );
}

function CaseBoard({
  record,
  operator,
  dispatch,
}: {
  record: CaseRecord;
  operator: string;
  dispatch: Dispatch<CaseAction>;
}) {
  const [showRevise, setShowRevise] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);

  const current = currentVersion(record);
  const blocked = isBlocked(record);
  const status = versionStatus(record, current);
  const supportCount = stanceCount(record, current.id, "support");
  const contradictCount = stanceCount(record, current.id, "contradict");
  const canOperate = operator === record.owner;
  const issues = auditCase(record);

  const sortedEvidence = [...record.evidence].sort((a, b) => b.sessionDate.localeCompare(a.sessionDate));
  const supports = sortedEvidence.filter((e) => e.stance === "support");
  const contradicts = sortedEvidence.filter((e) => e.stance === "contradict");

  const addEvidence = (stance: Stance, fact: string, sessionDate: string) => {
    const entry: EvidenceEntry = {
      id: uid("ev"),
      versionId: current.id,
      stance,
      fact,
      sessionDate,
      author: operator,
      createdAt: new Date().toISOString(),
    };
    dispatch({ type: "ADD_EVIDENCE", caseId: record.id, entry });
  };

  const confirmHypothesis = () => {
    dispatch({ type: "CONFIRM_HYPOTHESIS", caseId: record.id, by: operator, at: new Date().toISOString() });
  };

  const reviseHypothesis = (hypothesis: string, rationale: string, revisionReason: string) => {
    const version: HypothesisVersion = {
      id: uid("hv"),
      version: current.version + 1,
      hypothesis,
      rationale,
      revisionReason,
      createdBy: operator,
      createdAt: new Date().toISOString(),
      confirmedBy: null,
      confirmedAt: null,
    };
    dispatch({ type: "REVISE_HYPOTHESIS", caseId: record.id, version });
    setShowRevise(false);
  };

  const transferCase = (to: string, note: string) => {
    const transfer: TransferRecord = {
      id: uid("tr"),
      from: record.owner,
      to,
      note,
      at: new Date().toISOString(),
    };
    dispatch({ type: "TRANSFER_CASE", caseId: record.id, transfer });
    setShowTransfer(false);
  };

  return (
    <section className="panel board">
      <div className="section-heading">
        <div>
          <p>
            {record.topic} · 当前负责：{record.owner}
          </p>
          <h2>{record.clientCode} · 临床假设证据台</h2>
        </div>
        <div className="heading-actions">
          <button disabled={!canOperate} onClick={() => setShowTransfer((v) => !v)}>
            转介个案
          </button>
        </div>
      </div>

      {issues.length === 0 ? (
        <p className="audit-ok">
          ✓ 重开核对通过：当前假设 v{current.version} · 证据 {record.evidence.length} 条 · 版本 {record.versions.length}{" "}
          个，假设-证据-版本链一致
        </p>
      ) : (
        <div className="audit-bad">⚠ 数据不一致：{issues.join("；")}</div>
      )}

      <article className={`hypothesis-card ${blocked ? "blocked" : ""}`}>
        <div className="hypothesis-head">
          <span className="version-badge">当前假设 v{current.version}</span>
          <span className={`status-pill ${status}`}>{VERSION_STATUS_TEXT[status]}</span>
        </div>
        <h3>{current.hypothesis}</h3>
        <p className="rationale">判断依据：{current.rationale}</p>
        {current.revisionReason && <p className="revision-reason">修订原因：{current.revisionReason}</p>}
        {current.confirmedBy && !blocked && (
          <p className="hint">
            已于 {fmtDateTime(current.confirmedAt ?? current.createdAt)} 由 {current.confirmedBy} 确认。
          </p>
        )}
        <div className="stance-counts">
          <span className="support">支持事实 {supportCount} 条</span>
          <span className="contradict">
            相反事实 {contradictCount} / {CONTRADICT_LIMIT} 条
          </span>
        </div>
        {blocked && (
          <div className="blocked-banner">
            相反事实已累计 {contradictCount} 条，当前假设不能直接确认。请填写修订原因后另存为新版本；旧版本与证据链保留可查。
          </div>
        )}
        <div className="actions">
          <button
            className="primary-action"
            disabled={!canOperate || blocked || Boolean(current.confirmedBy)}
            onClick={confirmHypothesis}
          >
            {current.confirmedBy && !blocked ? "已确认" : "确认当前假设"}
          </button>
          <button disabled={!canOperate} onClick={() => setShowRevise((v) => !v)}>
            修订并另存新版本
          </button>
        </div>
        {!canOperate && (
          <p className="hint">
            当前个案由 {record.owner} 负责，{operator} 仅可查看；所有历史记录只读，任何人都不能改写。
          </p>
        )}
      </article>

      {showRevise && canOperate && (
        <RevisionForm nextVersion={current.version + 1} onSubmit={reviseHypothesis} onCancel={() => setShowRevise(false)} />
      )}
      {showTransfer && canOperate && (
        <TransferForm record={record} onSubmit={transferCase} onCancel={() => setShowTransfer(false)} />
      )}

      <EvidenceForm disabled={!canOperate} onAdd={addEvidence} />

      <section>
        <h3 className="subsection-title">证据链（全部 {record.evidence.length} 条，按会谈日期倒序）</h3>
        <div className="ledger">
          <div className="ledger-col">
            <h4>支持事实（{supports.length}）</h4>
            {supports.map((entry) => (
              <EvidenceCard key={entry.id} entry={entry} record={record} />
            ))}
            {supports.length === 0 && <p className="hint">暂无支持事实</p>}
          </div>
          <div className="ledger-col">
            <h4>相反事实（{contradicts.length}）</h4>
            {contradicts.map((entry) => (
              <EvidenceCard key={entry.id} entry={entry} record={record} />
            ))}
            {contradicts.length === 0 && <p className="hint">暂无相反事实</p>}
          </div>
        </div>
      </section>

      <section>
        <h3 className="subsection-title">假设版本记录（旧判断可随时回查）</h3>
        <div className="version-list">
          {[...record.versions].reverse().map((v) => {
            const vStatus = versionStatus(record, v);
            return (
              <article key={v.id} className={`version-card ${vStatus !== "history" ? "current" : ""}`}>
                <div className="version-head">
                  <span className="version-badge">v{v.version}</span>
                  <span className={`status-pill ${vStatus}`}>{VERSION_STATUS_TEXT[vStatus]}</span>
                  <span>
                    {v.createdBy} · {fmtDateTime(v.createdAt)}
                  </span>
                </div>
                <h4>{v.hypothesis}</h4>
                <p>判断依据：{v.rationale}</p>
                {v.revisionReason && <p className="revision-reason">修订原因：{v.revisionReason}</p>}
                {v.confirmedBy && (
                  <p>
                    已于 {fmtDateTime(v.confirmedAt ?? v.createdAt)} 由 {v.confirmedBy} 确认
                  </p>
                )}
                <p>
                  本版本证据：支持 {stanceCount(record, v.id, "support")} 条 · 相反{" "}
                  {stanceCount(record, v.id, "contradict")} 条
                </p>
              </article>
            );
          })}
        </div>
      </section>

      {record.transfers.length > 0 && (
        <section>
          <h3 className="subsection-title">转介记录</h3>
          <div className="transfer-list">
            {record.transfers.map((t) => (
              <div key={t.id} className="transfer-item">
                {fmtDateTime(t.at)} · {t.from} → {t.to}：{t.note}
              </div>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}

function App() {
  const [cases, dispatch] = useReducer(casesReducer, undefined, loadCases);
  const [selectedId, setSelectedId] = useState("");
  const [operator, setOperator] = useState(COUNSELORS[0]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cases));
    } catch {
      // 隐私模式等写入失败时保持内存态，不影响当次使用
    }
  }, [cases]);

  const selected = cases.find((c) => c.id === selectedId) ?? cases[0];

  const allEvidence = cases.flatMap((c) => c.evidence);
  const metrics = [
    { label: "活跃个案", value: String(cases.length) },
    { label: "待修订假设", value: String(cases.filter(isBlocked).length) },
    { label: "近 7 日登记事实", value: String(allEvidence.filter((e) => withinDays(e.sessionDate, 7)).length) },
    { label: "已完成转介", value: String(cases.reduce((n, c) => n + c.transfers.length, 0)) },
  ];

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">
            {project.id} · port {project.port}
          </p>
          <h1>{project.title}</h1>
          <p className="subtitle">{project.subtitle}</p>
        </div>
        <div className="stack-card">
          <span>技术栈</span>
          <strong>{project.stack}</strong>
        </div>
      </section>

      <section className="metrics-grid">
        {metrics.map((metric, index) => (
          <MetricCard key={metric.label} label={metric.label} value={metric.value} index={index} />
        ))}
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>个案列表</h2>
          <div className="case-list">
            {cases.map((c) => (
              <button
                key={c.id}
                type="button"
                className={c.id === selected.id ? "active" : ""}
                onClick={() => setSelectedId(c.id)}
              >
                <strong>
                  {c.clientCode} · {c.topic}
                </strong>
                <span className="case-meta">
                  <span>负责 {c.owner}</span>
                  <span>
                    <i className={`dot ${isBlocked(c) ? "blocked" : "ok"}`} />{" "}
                    {isBlocked(c) ? "待修订" : "进行中"} · v{currentVersion(c).version}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <h2>当前操作人</h2>
          <select value={operator} onChange={(e) => setOperator(e.target.value)}>
            {COUNSELORS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <p className="hint">
            规则：仅当前负责人可登记证据、确认或修订假设；相反事实累计 {CONTRADICT_LIMIT}{" "}
            条时禁止直接确认，须填修订原因另存新版本；转介后接手人只能追加证据，前任记录只读。
          </p>
        </aside>

        <CaseBoard record={selected} operator={operator} dispatch={dispatch} />
      </section>
    </main>
  );
}

export default App;
