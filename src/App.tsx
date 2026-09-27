import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import {
  CONTRADICT_LIMIT,
  USERS,
  activeVersion,
  addEvidence,
  confirmHypothesis,
  contradictCount,
  countKind,
  evidenceOf,
  isBlocked,
  loadStore,
  reviseHypothesis,
  saveStore,
  seedStore,
  transferCase,
} from "./domain";
import type { CaseFile, Evidence, EvidenceKind, HypothesisVersion, Store } from "./domain";

const project = {
  id: "hxwl-12",
  port: 5112,
  title: "心理咨询个案记录",
  subtitle:
    "临床假设证据台：当前假设与判断依据常驻个案页，会谈后分别登记支持事实与相反事实，相反事实累计两条即触发修订留痕。",
  stack: "React + Vite + TypeScript + CSS",
};

const THEME_FILTERS = ["全部", "焦虑", "亲密关系", "亲子", "职业压力"];

function thisWeekEvidenceCount(cases: CaseFile[]): number {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  return cases.reduce(
    (sum, c) =>
      sum + c.evidence.filter((e) => new Date(`${e.sessionDate}T00:00:00`) >= monday).length,
    0
  );
}

function MetricCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <i className={tone} />
    </article>
  );
}

function StatusBadge({ version, blocked }: { version: HypothesisVersion; blocked: boolean }) {
  if (version.status === "superseded") return <span className="badge badge-muted">历史版本</span>;
  if (blocked)
    return (
      <span className="badge badge-danger">相反事实已满 {CONTRADICT_LIMIT} 条 · 待修订</span>
    );
  if (version.status === "confirmed") return <span className="badge badge-ok">已确认</span>;
  return <span className="badge badge-active">当前版本</span>;
}

function EvidenceForm({
  versionNo,
  onSubmit,
}: {
  versionNo: number;
  onSubmit: (kind: EvidenceKind, fact: string, sessionDate: string) => void;
}) {
  const [kind, setKind] = useState<EvidenceKind>("support");
  const [fact, setFact] = useState("");
  const [sessionDate, setSessionDate] = useState(() => new Date().toISOString().slice(0, 10));

  const submit = () => {
    if (!fact.trim() || !sessionDate) return;
    onSubmit(kind, fact, sessionDate);
    setFact("");
  };

  return (
    <section className="sub-panel">
      <h3>
        会谈后登记证据 <small>登记到当前版本 v{versionNo}，提交后不可修改</small>
      </h3>
      <div className="kind-row">
        <label className={kind === "support" ? "kind-option support selected" : "kind-option support"}>
          <input
            type="radio"
            name="evidence-kind"
            checked={kind === "support"}
            onChange={() => setKind("support")}
          />
          支持事实
        </label>
        <label
          className={kind === "contradict" ? "kind-option contradict selected" : "kind-option contradict"}
        >
          <input
            type="radio"
            name="evidence-kind"
            checked={kind === "contradict"}
            onChange={() => setKind("contradict")}
          />
          相反事实
        </label>
        <label className="date-field">
          <span>会谈日期</span>
          <input type="date" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} />
        </label>
      </div>
      <textarea
        rows={3}
        value={fact}
        onChange={(e) => setFact(e.target.value)}
        placeholder="记录会谈中观察到的具体事实（而非解释或感受）…"
      />
      <div className="form-actions">
        <button className="primary-action" onClick={submit} disabled={!fact.trim()}>
          登记证据
        </button>
        {kind === "contradict" && (
          <span className="hint">相反事实累计到 {CONTRADICT_LIMIT} 条将触发假设修订流程</span>
        )}
      </div>
    </section>
  );
}

function RevisionForm({
  nextVersionNo,
  highlighted,
  onSubmit,
}: {
  nextVersionNo: number;
  highlighted: boolean;
  onSubmit: (hypothesis: string, rationale: string, reason: string) => void;
}) {
  const [hypothesis, setHypothesis] = useState("");
  const [rationale, setRationale] = useState("");
  const [reason, setReason] = useState("");
  const ready = Boolean(hypothesis.trim() && rationale.trim() && reason.trim());

  const submit = () => {
    if (!ready) return;
    onSubmit(hypothesis, rationale, reason);
    setHypothesis("");
    setRationale("");
    setReason("");
  };

  return (
    <section className={highlighted ? "sub-panel revision highlighted" : "sub-panel revision"}>
      <h3>
        修订假设 · 另存为新版本 v{nextVersionNo}{" "}
        <small>修订原因必填；保存后旧版本自动归档，保留可查</small>
      </h3>
      <div className="field-grid">
        <label>
          <span>新假设</span>
          <textarea
            rows={2}
            value={hypothesis}
            onChange={(e) => setHypothesis(e.target.value)}
            placeholder="修订后的临床假设…"
          />
        </label>
        <label>
          <span>判断依据</span>
          <textarea
            rows={2}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder="支持新假设的观察与评估依据…"
          />
        </label>
      </div>
      <label>
        <span>修订原因（必填）</span>
        <textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="说明哪些相反事实促使修订、原假设何处不再成立…"
        />
      </label>
      <div className="form-actions">
        <button className="primary-action" onClick={submit} disabled={!ready}>
          另存为新版本
        </button>
        {!ready && <span className="hint">新假设、判断依据、修订原因均需填写</span>}
      </div>
    </section>
  );
}

function TransferForm({
  owner,
  onSubmit,
  onCancel,
}: {
  owner: string;
  onSubmit: (to: string, note: string) => void;
  onCancel: () => void;
}) {
  const candidates = USERS.filter((u) => u.role === "咨询师" && u.name !== owner);
  const [to, setTo] = useState(candidates[0]?.name ?? "");
  const [note, setNote] = useState("");

  return (
    <section className="sub-panel transfer">
      <h3>
        个案转介 <small>转介后接手人只能追加证据与版本，不能改写前任记录</small>
      </h3>
      <div className="kind-row">
        <label className="date-field">
          <span>接手咨询师</span>
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            {candidates.map((u) => (
              <option key={u.name} value={u.name}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label className="date-field grow">
          <span>转介说明</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="转介原因、待跟进事项…"
          />
        </label>
      </div>
      <div className="form-actions">
        <button className="primary-action" onClick={() => to && onSubmit(to, note)} disabled={!to}>
          确认转介
        </button>
        <button onClick={onCancel}>取消</button>
      </div>
    </section>
  );
}

function EvidenceColumn({
  title,
  kind,
  items,
  limit,
}: {
  title: string;
  kind: EvidenceKind;
  items: Evidence[];
  limit?: number;
}) {
  return (
    <div className={`evidence-col ${kind}`}>
      <h4>
        {title}{" "}
        <span>{limit ? `${items.length}/${limit}` : `${items.length} 条`}</span>
      </h4>
      {items.length === 0 && <p className="empty">暂无记录</p>}
      {items.map((e) => (
        <article key={e.id} className={`evidence-item ${kind}`}>
          <p>{e.fact}</p>
          <small>
            会谈 {e.sessionDate} · 登记人 {e.author}
          </small>
        </article>
      ))}
    </div>
  );
}

function VersionItem({ caseFile, version }: { caseFile: CaseFile; version: HypothesisVersion }) {
  const items = evidenceOf(caseFile, version.id);
  const isCurrent = version.id === caseFile.currentVersionId;
  return (
    <article className={isCurrent ? "version-item current" : "version-item"}>
      <header>
        <span className="version-tag">v{version.versionNo}</span>
        <StatusBadge version={version} blocked={isCurrent && isBlocked(caseFile)} />
        <span className="meta">
          登记人 {version.createdBy} · {version.createdAt.slice(0, 10)}
        </span>
      </header>
      <p className="v-hypothesis">{version.hypothesis}</p>
      <p className="meta">判断依据：{version.rationale}</p>
      {version.revisionReason && <p className="revision-reason">修订原因：{version.revisionReason}</p>}
      <ul className="evidence-mini">
        {items.length === 0 && <li className="empty">该版本暂无证据</li>}
        {items.map((e) => (
          <li key={e.id} className={e.kind}>
            <em>{e.kind === "support" ? "支持" : "相反"}</em>
            <span>{e.fact}</span>
            <small>
              {e.sessionDate} · {e.author}
            </small>
          </li>
        ))}
      </ul>
    </article>
  );
}

function CaseBoard({
  caseFile,
  currentUser,
  onChange,
}: {
  caseFile: CaseFile;
  currentUser: string;
  onChange: (next: CaseFile) => void;
}) {
  const [showTransfer, setShowTransfer] = useState(false);
  const version = activeVersion(caseFile);
  const blocked = isBlocked(caseFile);
  const contradicts = contradictCount(caseFile, version.id);
  const supports = countKind(caseFile, version.id, "support");
  const isOwner = currentUser === caseFile.owner;
  const currentEvidence = evidenceOf(caseFile, version.id);
  const sortedVersions = [...caseFile.versions].sort((a, b) => b.versionNo - a.versionNo);

  const blockedText =
    version.status === "confirmed"
      ? `该假设此前已确认，但相反事实已累计 ${contradicts} 条，确认结论需重新检视：请填清修订原因，另存为新版本 v${version.versionNo + 1}。`
      : `相反事实已累计 ${contradicts} 条：原假设不能直接确认。请填清修订原因，另存为新版本 v${version.versionNo + 1}；旧判断保留在下方版本历史可查。`;

  return (
    <div className="board">
      <div className="section-heading">
        <div>
          <p>
            {caseFile.theme} · 风险等级 {caseFile.risk}
          </p>
          <h2>{caseFile.clientCode} · 假设证据台</h2>
          <p className="owner-line">
            当前负责人：{caseFile.owner}
            {isOwner ? "（你）" : ""}
          </p>
        </div>
        {isOwner && (
          <button onClick={() => setShowTransfer((v) => !v)}>
            {showTransfer ? "取消转介" : "个案转介"}
          </button>
        )}
      </div>

      {!isOwner && (
        <div className="banner info">
          当前身份 {currentUser} 不是本案负责人，仅可查看；证据登记、修订与转介仅负责人{" "}
          {caseFile.owner} 可操作。
        </div>
      )}

      {showTransfer && isOwner && (
        <TransferForm
          owner={caseFile.owner}
          onCancel={() => setShowTransfer(false)}
          onSubmit={(to, note) => {
            onChange(transferCase(caseFile, { to, note }));
            setShowTransfer(false);
          }}
        />
      )}

      <section className="hypothesis-card">
        <div className="hypothesis-head">
          <span className="version-tag">v{version.versionNo}</span>
          <StatusBadge version={version} blocked={blocked} />
          <span className="evidence-count">
            支持 {supports} · 相反 {contradicts}/{CONTRADICT_LIMIT}
          </span>
        </div>
        <h3>{version.hypothesis}</h3>
        <p className="rationale">判断依据：{version.rationale}</p>
        {version.revisionReason && (
          <p className="revision-reason">修订原因：{version.revisionReason}</p>
        )}
        <p className="meta">
          登记人 {version.createdBy} · {version.createdAt.slice(0, 10)}
        </p>
        {blocked && <div className="banner danger">{blockedText}</div>}
        {isOwner && version.status === "active" && (
          <div className="form-actions">
            <button
              className="primary-action"
              disabled={blocked}
              title={blocked ? `相反事实已达 ${CONTRADICT_LIMIT} 条，不能直接确认` : "将当前假设标记为已确认"}
              onClick={() => onChange(confirmHypothesis(caseFile))}
            >
              确认当前假设
            </button>
            {blocked && <span className="hint">需先修订为新版本</span>}
          </div>
        )}
      </section>

      {isOwner && (
        <EvidenceForm
          versionNo={version.versionNo}
          onSubmit={(kind, fact, sessionDate) =>
            onChange(addEvidence(caseFile, { kind, fact, sessionDate, author: currentUser }))
          }
        />
      )}

      <section className="sub-panel">
        <h3>
          当前版本证据链 <small>v{version.versionNo} · 会谈后分别登记</small>
        </h3>
        <div className="evidence-board">
          <EvidenceColumn
            title="支持事实"
            kind="support"
            items={currentEvidence.filter((e) => e.kind === "support")}
          />
          <EvidenceColumn
            title="相反事实"
            kind="contradict"
            items={currentEvidence.filter((e) => e.kind === "contradict")}
            limit={CONTRADICT_LIMIT}
          />
        </div>
      </section>

      {isOwner && (
        <RevisionForm
          nextVersionNo={version.versionNo + 1}
          highlighted={blocked}
          onSubmit={(hypothesis, rationale, reason) =>
            onChange(
              reviseHypothesis(caseFile, {
                hypothesis,
                rationale,
                revisionReason: reason,
                author: currentUser,
              })
            )
          }
        />
      )}

      <section className="sub-panel">
        <h3>
          版本历史 <small>旧判断保留可查，证据链随版本归档，不提供修改或删除入口</small>
        </h3>
        {sortedVersions.map((v) => (
          <VersionItem key={v.id} caseFile={caseFile} version={v} />
        ))}
      </section>

      <section className="sub-panel">
        <h3>
          转介记录 <small>转介后接手人只能追加证据与版本</small>
        </h3>
        {caseFile.transfers.length === 0 ? (
          <p className="empty">暂无转介记录</p>
        ) : (
          <ul className="transfer-list">
            {caseFile.transfers.map((t) => (
              <li key={t.id}>
                <strong>
                  {t.from} → {t.to}
                </strong>
                <span>{t.at.slice(0, 10)}</span>
                {t.note && <p>{t.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function App() {
  const [store, setStore] = useState<Store>(() => loadStore());
  const [themeFilter, setThemeFilter] = useState("全部");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    saveStore(store);
  }, [store]);

  const filtered = useMemo(
    () => store.cases.filter((c) => themeFilter === "全部" || c.theme === themeFilter),
    [store.cases, themeFilter]
  );
  const selected = store.cases.find((c) => c.id === selectedId) ?? filtered[0] ?? null;

  const metrics = [
    { label: "活跃个案", value: store.cases.length, tone: "status-ok" },
    { label: "待修订假设", value: store.cases.filter(isBlocked).length, tone: "status-danger" },
    { label: "本周登记证据", value: thisWeekEvidenceCount(store.cases), tone: "status-watch" },
    {
      label: "累计证据",
      value: store.cases.reduce((n, c) => n + c.evidence.length, 0),
      tone: "status-ok",
    },
  ];

  const updateCase = (next: CaseFile) =>
    setStore((s) => ({ ...s, cases: s.cases.map((c) => (c.id === next.id ? next : c)) }));

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
        {metrics.map((m) => (
          <MetricCard key={m.label} label={m.label} value={m.value} tone={m.tone} />
        ))}
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>当前用户</h2>
          <div className="chips">
            {USERS.map((u) => (
              <button
                key={u.name}
                className={u.name === store.currentUser ? "user-chip active" : "user-chip"}
                onClick={() => setStore((s) => ({ ...s, currentUser: u.name }))}
              >
                {u.name} · {u.role}
              </button>
            ))}
          </div>

          <h2>个案筛选</h2>
          <div className="chips muted">
            {THEME_FILTERS.map((t) => (
              <button
                key={t}
                className={t === themeFilter ? "filter-chip active" : "filter-chip"}
                onClick={() => setThemeFilter(t)}
              >
                {t}
              </button>
            ))}
          </div>

          <h2>个案列表</h2>
          <div className="case-list">
            {filtered.map((c) => (
              <button
                key={c.id}
                className={selected?.id === c.id ? "case-item selected" : "case-item"}
                onClick={() => setSelectedId(c.id)}
              >
                <strong>{c.clientCode}</strong>
                <span>
                  {c.theme} · {c.risk}
                </span>
                <span className="case-owner">负责人 {c.owner}</span>
                {isBlocked(c) && <em className="tag-danger">待修订</em>}
              </button>
            ))}
            {filtered.length === 0 && <p className="empty">该主题下暂无个案</p>}
          </div>

          <div className="rule-card">
            <h2>证据台规则</h2>
            <ul>
              <li>证据只增不改，按登记人署名归档</li>
              <li>相反事实满 {CONTRADICT_LIMIT} 条，原假设不能直接确认，须填修订原因另存新版本</li>
              <li>转介后接手人只能追加证据与版本，不能改写前任记录</li>
              <li>数据保存在本地，重开后当前假设、证据链与版本自动对齐</li>
            </ul>
          </div>

          <button
            className="reset-btn"
            onClick={() => {
              if (window.confirm("确定清空本地数据并恢复演示数据？")) setStore(seedStore());
            }}
          >
            重置演示数据
          </button>
        </aside>

        <section className="panel">
          {selected ? (
            <CaseBoard
              key={selected.id}
              caseFile={selected}
              currentUser={store.currentUser}
              onChange={updateCase}
            />
          ) : (
            <p className="empty">暂无个案</p>
          )}
        </section>
      </section>
    </main>
  );
}

export default App;
