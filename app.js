/* 宅建士 並走ノート
 * 静的サイト（ビルド不要）。学習データはブラウザの localStorage に保存する。
 */
(() => {
  "use strict";

  const QS = window.QUESTIONS;
  const LAWS = window.LAWS;
  const SRC = window.LAW_SOURCES;
  const INFO = window.EXAM_INFO;
  const SUBJ = Object.fromEntries(INFO.subjects.map((s) => [s.key, s]));
  const SKEYS = INFO.subjects.map((s) => s.key);
  const QMAP = Object.fromEntries(QS.map((q) => [q.id, q]));
  const CARDS = LAWS.flatMap((l) => l.keys.map((k, i) => ({ id: `${l.id}-${i}`, law: l, q: k[0], a: k[1] })));

  const STORE_KEY = "takken-v1";
  const SRS_DAYS = [0, 1, 3, 7, 14, 30];
  const WEEK_FOCUS = { 0: "review", 1: "gyo", 2: "ken", 3: "hou", 4: "gyo", 5: "zei", 6: "weak" };
  const WEEK_LABEL = ["日", "月", "火", "水", "木", "金", "土"];

  // ───────── 日付ユーティリティ ─────────
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
  const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
  const today = () => ymd();
  const fmtJP = (s) => { const d = parse(s); return `${d.getMonth() + 1}月${d.getDate()}日（${WEEK_LABEL[d.getDay()]}）`; };

  // ───────── 保存データ ─────────
  const defaults = () => ({
    v: 1,
    settings: { examDate: "2027-10-17", dailyGoal: 10, startDate: today(), theme: "auto" },
    answers: {},  // qid: { n, ok, last, box, due, lastOk }
    log: {},      // date: { q, ok, cards }
    cards: {},    // cardId: { n, known }
    mocks: [],
  });
  let S;
  try { S = Object.assign(defaults(), JSON.parse(localStorage.getItem(STORE_KEY) || "{}")); }
  catch { S = defaults(); }
  S.settings = Object.assign(defaults().settings, S.settings);
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch { toast("保存できませんでした（ブラウザの設定を確認してください）"); } };

  const dayLog = (d = today()) => (S.log[d] ||= { q: 0, ok: 0, cards: 0 });

  // ───────── 集計 ─────────
  function subjectStats(key) {
    const qs = QS.filter((q) => q.s === key);
    let tried = 0, n = 0, ok = 0, mastered = 0;
    for (const q of qs) {
      const a = S.answers[q.id];
      if (!a) continue;
      tried++; n += a.n; ok += a.ok;
      if (a.box >= 3) mastered++;
    }
    return { total: qs.length, tried, n, ok, rate: n ? ok / n : null, mastered, line: SUBJ[key].target / SUBJ[key].count };
  }
  function overall() {
    let n = 0, ok = 0, tried = 0;
    for (const a of Object.values(S.answers)) { n += a.n; ok += a.ok; tried++; }
    return { n, ok, tried, rate: n ? ok / n : null };
  }
  function dueIds() {
    const t = today();
    return Object.entries(S.answers).filter(([id, a]) => QMAP[id] && a.due && a.due <= t).map(([id]) => id);
  }
  function streak() {
    let d = today(), c = 0;
    if (!(S.log[d]?.q > 0 || S.log[d]?.cards > 0)) d = addDays(d, -1);
    while (S.log[d]?.q > 0 || S.log[d]?.cards > 0) { c++; d = addDays(d, -1); }
    return c;
  }
  function weakest() {
    let best = null;
    for (const k of SKEYS) {
      const st = subjectStats(k);
      // 未着手は最優先、次に合格ラインとの差が大きい科目
      const score = st.rate === null ? -1 : st.rate - st.line;
      if (!best || score < best.score) best = { key: k, score };
    }
    return best.key;
  }
  function focusOf(dateStr = today()) {
    const f = WEEK_FOCUS[parse(dateStr).getDay()];
    if (f === "weak") return weakest();
    return f;
  }
  function phaseInfo() {
    const left = diffDays(today(), S.settings.examDate);
    if (left < 0) return { key: "after", name: "試験後", left, text: "試験おつかれさまでした。結果を待つ間に、登録実務講習や登録の準備を調べておきましょう。" };
    if (left <= 60) return { key: "final", name: "直前期", left, text: "新しい論点は広げず、50問模試と苦手の総点検、数値の最終暗記に絞る時期です。" };
    if (left <= 180) return { key: "drill", name: "演習期", left, text: "過去問レベルの演習で回転数を上げる時期。間違えた問題を必ず復習に回しましょう。" };
    return { key: "base", name: "基礎期", left, text: "全科目を一通り触り、用語と数値の土台を作る時期。毎日続けることを最優先に。" };
  }

  // ───────── 回答の記録（間隔反復） ─────────
  function record(qid, correct) {
    const a = (S.answers[qid] ||= { n: 0, ok: 0, box: 0 });
    a.n++; if (correct) a.ok++;
    a.last = today(); a.lastOk = correct;
    a.box = correct ? Math.min(a.box + 1, 5) : 1;
    a.due = addDays(today(), correct ? SRS_DAYS[a.box] : 1);
    const L = dayLog(); L.q++; if (correct) L.ok++;
    save();
  }

  // ───────── 汎用 ─────────
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pct = (x) => (x === null || x === undefined ? "—" : `${Math.round(x * 100)}%`);
  const sColor = (k) => `var(--s-${k})`;
  let toastTimer;
  function toast(msg) {
    let el = $(".toast"); if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }
  // ページ内の確認ダイアログ（埋め込み環境では confirm() が使えないため）
  function ask(msg, okLabel = "はい") {
    return new Promise((resolve) => {
      const wrap = document.createElement("div");
      wrap.className = "modal";
      wrap.innerHTML = `<div class="modal-box card" role="dialog" aria-modal="true">
        <p style="margin:0 0 16px">${esc(msg)}</p>
        <div class="grid2"><button class="btn quiet" data-r="0">やめる</button><button class="btn" data-r="1">${esc(okLabel)}</button></div></div>`;
      document.body.appendChild(wrap);
      wrap.addEventListener("click", (e) => {
        const b = e.target.closest("[data-r]");
        if (!b && e.target !== wrap) return;
        wrap.remove(); resolve(b ? b.dataset.r === "1" : false);
      });
      wrap.querySelector('[data-r="1"]').focus();
    });
  }
  function applyTheme() {
    const t = S.settings.theme;
    if (t === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
  }

  // ───────── ルーティング ─────────
  const app = $("#app");
  let session = null;   // 演習・模試の進行状態
  let timerId = null;

  function route() {
    clearInterval(timerId);
    const [, view = "today", arg] = (location.hash || "#/today").split("/");
    document.querySelectorAll(".tabbar a").forEach((a) => {
      const tab = a.dataset.tab;
      a.classList.toggle("active", tab === view || (view === "session" && session && tab === (session.kind === "mock" ? "mock" : "drill")) || (view === "cards" && tab === "laws"));
    });
    renderTop();
    const views = { today: vToday, drill: vDrill, session: vSession, laws: vLaws, cards: vCards, mock: vMock, plan: vPlan };
    (views[view] || vToday)(arg);
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  function renderTop() {
    const left = diffDays(today(), S.settings.examDate);
    $("#topCount").innerHTML = left >= 0 ? `試験まで<b>${left}</b>日` : `試験 終了`;
  }

  // ───────── 今日 ─────────
  function vToday() {
    const ph = phaseInfo();
    const L = dayLog();
    const goal = S.settings.dailyGoal;
    const due = dueIds();
    const focus = focusOf();
    const o = overall();
    const st = streak();
    const focusName = focus === "review" ? "復習の日" : SUBJ[focus].name;
    const newGoal = Math.max(5, goal - due.length);
    const cardsGoal = 5;

    const step1Done = due.length === 0 && (L.q > 0 || o.tried > 0);
    const step2Done = L.q >= goal;
    const step3Done = L.cards >= cardsGoal;

    app.innerHTML = `
      <section class="card hero">
        <div class="kicker">${fmtJP(today())}　／　本試験 ${fmtJP(S.settings.examDate)}</div>
        <div class="row" style="align-items:flex-end;justify-content:space-between;margin-top:6px">
          <div class="days">${Math.max(ph.left, 0)}<small>日</small></div>
          <div style="text-align:right">
            <div class="tiny">今日の演習</div>
            <div style="font-family:var(--serif);font-size:22px">${L.q}<span class="muted small"> / ${goal}問</span></div>
          </div>
        </div>
        <div class="progress" style="margin-top:10px"><i style="width:${Math.min(100, (L.q / goal) * 100)}%"></i></div>
        <div class="phase"><span class="tag">${ph.name}</span><span class="muted small">${ph.text}</span></div>
        <div class="coach">${coachMessage({ due, focus, L, goal, st, o })}</div>
      </section>

      <section class="section">
        <div class="section-head"><h2>今日のメニュー</h2><span class="sub">今日のテーマ：${esc(focusName)}</span></div>
        <div class="card">
          <div class="menu-item ${step1Done ? "done" : ""}">
            <span class="num">${step1Done ? "✓" : "1"}</span>
            <div class="grow"><div class="title">復習</div><div class="desc">${due.length ? `期限が来た問題が ${due.length}問 あります` : "期限の来た問題はありません"}</div></div>
            <button class="btn ${due.length ? "" : "quiet"}" data-act="review" ${due.length ? "" : "disabled"}>解く</button>
          </div>
          <div class="menu-item ${step2Done ? "done" : ""}">
            <span class="num">${step2Done ? "✓" : "2"}</span>
            <div class="grow"><div class="title">新しい問題 ${newGoal}問</div><div class="desc">${focus === "review" ? "苦手な科目から出題します" : `${esc(SUBJ[focus].name)}を中心に出題します`}</div></div>
            <button class="btn" data-act="new">解く</button>
          </div>
          <div class="menu-item ${step3Done ? "done" : ""}">
            <span class="num">${step3Done ? "✓" : "3"}</span>
            <div class="grow"><div class="title">法令の数値カード ${cardsGoal}枚</div><div class="desc">今日 ${L.cards}枚 めくりました</div></div>
            <a class="btn ghost" href="#/cards">めくる</a>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="grid3">
          <div class="stat"><div class="k">連続学習</div><div class="v">${st}<small> 日</small></div></div>
          <div class="stat"><div class="k">累計回答</div><div class="v">${o.n}<small> 問</small></div></div>
          <div class="stat"><div class="k">正答率</div><div class="v">${pct(o.rate)}</div></div>
        </div>
      </section>

      <section class="section">
        <div class="section-head"><h2>科目別の正答率</h2><span class="sub">赤線＝科目別の目標点の得点率</span></div>
        <div class="card">${SKEYS.map(subjectBar).join("")}</div>
      </section>

      <section class="section">
        <div class="section-head"><h2>直近30日</h2><span class="sub">1日の回答数</span></div>
        <div class="card">${heatmap()}</div>
      </section>
    `;
    app.querySelector('[data-act="review"]')?.addEventListener("click", () => startSession("review", shuffle(due)));
    app.querySelector('[data-act="new"]').addEventListener("click", () => {
      const subj = focus === "review" ? weakest() : focus;
      startSession("drill", pickNew(subj, newGoal));
    });
  }

  function coachMessage({ due, focus, L, goal, st, o }) {
    if (o.n === 0) return `<b>はじめまして。</b>まずは今日のメニュー2の「新しい問題」から5問だけ解いてみましょう。間違えた問題は自動で復習に回ります。`;
    if (L.q >= goal && L.cards >= 5 && due.length === 0) return `<b>今日のノルマは達成です。</b>余力があれば、苦手な${esc(SUBJ[weakest()].name)}をもう数問。無理せず明日につなげるのも立派な計画です。`;
    if (due.length >= 10) return `<b>復習が${due.length}問たまっています。</b>新しい問題より先に、間違えた問題を片付けると定着が早くなります。`;
    const w = weakest(); const ws = subjectStats(w);
    if (ws.rate !== null && ws.rate < ws.line) return `<b>${esc(SUBJ[w].name)}が目標を下回っています</b>（${pct(ws.rate)}／目標${pct(ws.line)}）。ここを優先して底上げしましょう。`;
    if (st >= 7) return `<b>${st}日連続です。</b>この調子で、毎日少しずつでも机に向かう習慣を守りましょう。`;
    if (L.q === 0) return `<b>今日はまだ0問です。</b>まずは1問だけ。始めてしまえば、たいてい続きます。`;
    return `<b>あと${Math.max(0, goal - L.q)}問で今日の目標です。</b>今日のテーマは${focus === "review" ? "復習" : esc(SUBJ[focus].name)}。`;
  }

  function subjectBar(k) {
    const st = subjectStats(k);
    const w = st.rate === null ? 0 : st.rate * 100;
    return `<div class="sbar">
      <div class="name"><span class="dot" style="background:${sColor(k)}"></span>${esc(SUBJ[k].name)}</div>
      <div class="track"><div class="fill" style="width:${w}%;background:${sColor(k)}"></div><div class="line" style="left:${st.line * 100}%"></div></div>
      <div class="val">${pct(st.rate)}<span class="tiny"> ${st.tried}/${st.total}</span></div>
    </div>`;
  }

  function heatmap() {
    const cells = [];
    for (let i = 29; i >= 0; i--) {
      const d = addDays(today(), -i);
      const n = S.log[d]?.q || 0;
      const lv = n === 0 ? 0 : n < 5 ? 1 : n < 10 ? 2 : n < 20 ? 3 : 4;
      cells.push(`<i class="l${lv} ${i === 0 ? "today" : ""}" title="${d}：${n}問"></i>`);
    }
    return `<div class="heat">${cells.join("")}</div><div class="row tiny" style="justify-content:space-between;margin-top:8px"><span>30日前</span><span>今日</span></div>`;
  }

  function pickNew(subj, n) {
    const unseen = (k) => shuffle(QS.filter((q) => q.s === k && !S.answers[q.id]).map((q) => q.id));
    let ids = unseen(subj);
    if (ids.length < n) {
      // 他科目の未着手 → 正答率の低い既出問題 の順に補う
      const others = SKEYS.filter((k) => k !== subj).flatMap(unseen);
      ids = ids.concat(shuffle(others));
    }
    if (ids.length < n) {
      const seen = QS.filter((q) => S.answers[q.id] && !ids.includes(q.id))
        .sort((a, b) => (S.answers[a.id].ok / S.answers[a.id].n) - (S.answers[b.id].ok / S.answers[b.id].n))
        .map((q) => q.id);
      ids = ids.concat(seen);
    }
    return ids.slice(0, n);
  }

  // ───────── 演習（科目選択） ─────────
  let drillFilter = { subj: "all", mode: "new", n: 10 };
  function vDrill() {
    const pool = drillPool();
    app.innerHTML = `
      <div class="section-head"><h1 style="font-size:22px">問題演習</h1><span class="sub">全${QS.length}問・4択</span></div>
      <div class="card">
        <div class="small muted" style="margin-bottom:8px">科目</div>
        <div class="row" id="fSubj">
          <button class="chip ${drillFilter.subj === "all" ? "on" : ""}" data-v="all">すべて</button>
          ${SKEYS.map((k) => `<button class="chip ${drillFilter.subj === k ? "on" : ""}" data-v="${k}"><span class="dot" style="background:${sColor(k)}"></span>${SUBJ[k].name}</button>`).join("")}
        </div>
        <hr class="sep">
        <div class="small muted" style="margin-bottom:8px">出題</div>
        <div class="row" id="fMode">
          ${[["new", "未着手"], ["wrong", "間違えた問題"], ["random", "ランダム"], ["all", "順番どおり"]].map(([v, l]) => `<button class="chip ${drillFilter.mode === v ? "on" : ""}" data-v="${v}">${l}</button>`).join("")}
        </div>
        <hr class="sep">
        <div class="small muted" style="margin-bottom:8px">問題数</div>
        <div class="row" id="fN">
          ${[5, 10, 20, 0].map((v) => `<button class="chip ${drillFilter.n === v ? "on" : ""}" data-v="${v}">${v ? v + "問" : "全部"}</button>`).join("")}
        </div>
        <div style="margin-top:16px">
          <button class="btn block" id="go" ${pool.length ? "" : "disabled"}>${pool.length ? `${drillFilter.n ? Math.min(drillFilter.n, pool.length) : pool.length}問はじめる` : "該当する問題がありません"}</button>
        </div>
      </div>

      <div class="section">
        <div class="section-head"><h2>分野一覧</h2><span class="sub">分野名をタップでその分野だけ解く</span></div>
        ${SKEYS.filter((k) => drillFilter.subj === "all" || drillFilter.subj === k).map(topicList).join("")}
      </div>
    `;
    const bind = (id, key, num) => $(id).addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      drillFilter[key] = num ? Number(b.dataset.v) : b.dataset.v; vDrill();
    });
    bind("#fSubj", "subj"); bind("#fMode", "mode"); bind("#fN", "n", true);
    $("#go").addEventListener("click", () => {
      const ids = drillFilter.n ? pool.slice(0, drillFilter.n) : pool;
      startSession("drill", ids);
    });
    app.querySelectorAll("[data-topic]").forEach((el) => el.addEventListener("click", () => {
      const [s, t] = el.dataset.topic.split("|");
      startSession("drill", QS.filter((q) => q.s === s && q.t === t).map((q) => q.id));
    }));
  }
  function drillPool() {
    let qs = QS.filter((q) => drillFilter.subj === "all" || q.s === drillFilter.subj);
    if (drillFilter.mode === "new") qs = shuffle(qs.filter((q) => !S.answers[q.id]));
    else if (drillFilter.mode === "wrong") qs = shuffle(qs.filter((q) => S.answers[q.id] && (S.answers[q.id].lastOk === false || S.answers[q.id].ok < S.answers[q.id].n)));
    else if (drillFilter.mode === "random") qs = shuffle(qs);
    return qs.map((q) => q.id);
  }
  function topicList(k) {
    const qs = QS.filter((q) => q.s === k);
    const topics = [...new Set(qs.map((q) => q.t))];
    return `<div class="card" style="margin-bottom:10px">
      <div class="row" style="margin-bottom:8px"><span class="dot" style="background:${sColor(k)}"></span><b>${SUBJ[k].name}</b><span class="tiny">本試験 ${SUBJ[k].count}問／目標 ${SUBJ[k].target}点</span></div>
      <div class="row" style="gap:6px">${topics.map((t) => {
        const tq = qs.filter((q) => q.t === t);
        const done = tq.filter((q) => S.answers[q.id]?.lastOk).length;
        return `<button class="chip" data-topic="${k}|${esc(t)}">${esc(t)}${done === tq.length ? " ✓" : ""}</button>`;
      }).join("")}</div>
    </div>`;
  }

  // ───────── セッション（演習・復習・模試 共通） ─────────
  function startSession(kind, ids, opts = {}) {
    if (!ids.length) { toast("出題できる問題がありません"); return; }
    session = {
      kind, ids, i: 0, results: [],
      orders: Object.fromEntries(ids.map((id) => [id, shuffle([0, 1, 2, 3])])),
      picked: null, startedAt: Date.now(), limitSec: opts.limitSec || 0,
    };
    if (location.hash === "#/session") route();
    else location.hash = "#/session";
  }

  function vSession() {
    if (!session) { location.hash = "#/drill"; return; }
    const s = session;
    if (s.i >= s.ids.length) return sessionResult();
    const q = QMAP[s.ids[s.i]];
    const order = s.orders[q.id];
    const isMock = s.kind === "mock";
    const answered = s.picked !== null;
    const labels = ["1", "2", "3", "4"];
    const kindLabel = { drill: "演習", review: "復習", mock: "模試" }[s.kind];

    app.innerHTML = `
      <div class="qhead">
        <div class="qmeta"><span class="tag">${kindLabel}</span><span>${s.i + 1} / ${s.ids.length}</span></div>
        <div class="row">
          ${isMock ? `<span class="timer" id="timer"></span>` : ""}
          <button class="btn quiet" id="quit" style="padding:6px 12px">${isMock ? "提出" : "やめる"}</button>
        </div>
      </div>
      <div class="progress" style="margin-bottom:14px"><i style="width:${(s.i / s.ids.length) * 100}%"></i></div>
      <div class="card">
        <div class="qmeta"><span class="dot" style="background:${sColor(q.s)}"></span>${SUBJ[q.s].name}・${esc(q.t)}</div>
        <div class="qtext">${esc(q.q)}</div>
        <div class="choices">
          ${order.map((ci, pos) => {
            let cls = "";
            if (answered && !isMock) {
              if (ci === q.a) cls = "correct";
              else if (ci === s.picked) cls = "wrong";
            }
            return `<button class="choice ${cls}" data-ci="${ci}" ${answered ? "disabled" : ""}><span class="no">${labels[pos]}</span><span>${esc(q.c[ci])}</span></button>`;
          }).join("")}
        </div>
        ${answered && !isMock ? verdictHTML(q, s.picked === q.a, order) : ""}
      </div>
      ${answered && !isMock ? `<div style="margin-top:14px"><button class="btn block" id="next">${s.i + 1 < s.ids.length ? "次の問題へ" : "結果を見る"}</button></div>` : ""}
    `;

    app.querySelectorAll(".choice").forEach((b) => b.addEventListener("click", () => {
      if (s.picked !== null) return;
      const ci = Number(b.dataset.ci);
      const ok = ci === q.a;
      s.results.push({ id: q.id, ok, picked: ci });
      if (isMock) {
        s.i++; s.picked = null; vSession(); return;
      }
      s.picked = ci;
      record(q.id, ok);
      vSession();
      $("#next")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }));
    $("#next")?.addEventListener("click", () => { s.i++; s.picked = null; vSession(); window.scrollTo(0, 0); });
    $("#quit").addEventListener("click", () => {
      if (isMock) {
        ask("ここで提出しますか？未回答の問題は不正解として扱います。", "提出する").then((y) => y && finishMock());
      } else if (s.results.length) { s.i = s.ids.length; vSession(); }
      else { session = null; location.hash = "#/today"; }
    });
    if (isMock) tickTimer();
  }

  function verdictHTML(q, ok, order) {
    const pos = order.indexOf(q.a) + 1;
    const src = q.r ? `<div class="ref">関連：${esc(q.r)}${lawLinkFor(q.r)}</div>` : "";
    return `<div class="verdict ${ok ? "ok" : "ng"}">
      <div class="mark">${ok ? "◯ 正解" : "✕ 不正解"}<span class="small muted" style="font-family:var(--sans);margin-left:8px">正答は ${pos}</span></div>
      <div style="margin-top:6px">${esc(q.e)}</div>
      ${src}
    </div>`;
  }
  function lawLinkFor(ref) {
    const map = [["宅地建物取引業法", "gyo"], ["民法", "min"], ["借地借家法", "shakuchi"], ["建物の区分所有等に関する法律", "kubun"], ["不動産登記法", "toki"], ["都市計画法", "toshi"], ["建築基準法", "kijun"], ["農地法", "nochi"], ["国土利用計画法", "kokudo"], ["宅地造成及び特定盛土等規制法", "takuzo"], ["土地区画整理法", "kukaku"]];
    const hit = map.find(([n]) => ref.startsWith(n));
    return hit ? ` <a href="${SRC[hit[1]].url}" target="_blank" rel="noopener">e-Govで条文を見る ↗</a>` : "";
  }

  function sessionResult() {
    const s = session;
    if (s.kind === "mock") return finishMock();
    const ok = s.results.filter((r) => r.ok).length;
    const n = s.results.length;
    const wrong = s.results.filter((r) => !r.ok);
    app.innerHTML = `
      <div class="card" style="text-align:center;padding:26px 18px">
        <div class="tiny">${{ drill: "演習", review: "復習" }[s.kind]}の結果</div>
        <div class="result-big">${ok}<span class="muted" style="font-size:22px"> / ${n}</span></div>
        <div class="muted">正答率 ${pct(n ? ok / n : null)}</div>
        <div class="progress" style="margin:14px auto 0;max-width:320px"><i style="width:${n ? (ok / n) * 100 : 0}%;background:var(--green)"></i></div>
        <p class="small muted" style="margin:14px 0 0">${wrong.length ? `間違えた ${wrong.length}問 は明日の復習に入ります。` : "全問正解です。正解した問題も、間隔をあけて再出題されます。"}</p>
      </div>
      ${wrong.length ? `<div class="section"><div class="section-head"><h2>間違えた問題</h2></div>
        ${wrong.map((r) => { const q = QMAP[r.id]; return `<div class="card"><div class="qmeta"><span class="dot" style="background:${sColor(q.s)}"></span>${SUBJ[q.s].name}・${esc(q.t)}</div>
          <div style="margin:6px 0"><span class="small muted">誤：</span>${esc(q.c[r.picked])}</div>
          <div><span class="small muted">正：</span><b>${esc(q.c[q.a])}</b></div>
          <div class="small muted" style="margin-top:6px">${esc(q.e)}</div></div>`; }).join("")}
      </div>` : ""}
      <div class="row" style="margin-top:16px">
        ${wrong.length ? `<button class="btn red grow" id="retry">間違えた問題をもう一度</button>` : ""}
        <a class="btn ghost grow" href="#/today">今日の画面へ</a>
      </div>
    `;
    $("#retry")?.addEventListener("click", () => startSession("drill", wrong.map((r) => r.id)));
  }

  // ───────── 模試 ─────────
  function vMock() {
    const last = S.mocks.slice(-5).reverse();
    app.innerHTML = `
      <div class="section-head"><h1 style="font-size:22px">模試</h1><span class="sub">時間を計って解く</span></div>
      <div class="card">
        <b>本試験形式（50問・2時間）</b>
        <p class="small muted" style="margin:4px 0 12px">本試験と同じ配分（宅建業法20・権利関係14・法令上の制限8・税その他8）でランダムに出題。解答中は正誤を表示しません。</p>
        <button class="btn block" data-mock="full">本試験形式ではじめる</button>
      </div>
      <div class="card">
        <b>ミニ模試（20問・50分）</b>
        <p class="small muted" style="margin:4px 0 12px">業法8・権利6・法令3・税その他3。平日の夜に1回分の時間配分を確かめたいときに。</p>
        <button class="btn ghost block" data-mock="mini">ミニ模試をはじめる</button>
      </div>
      <div class="section">
        <div class="section-head"><h2>本試験の構成</h2><span class="sub">目標点は一般的な目安</span></div>
        <div class="card">
          <table class="week">
            <tr><th style="width:auto">科目</th><td>問題数</td><td>目標</td></tr>
            ${INFO.subjects.map((s) => `<tr><th style="width:auto"><span class="dot" style="background:${sColor(s.key)}"></span> ${s.name}</th><td>${s.count}問</td><td>${s.target}点</td></tr>`).join("")}
            <tr><th style="width:auto"><b>合計</b></th><td>${INFO.total}問</td><td><b>${INFO.subjects.reduce((a, s) => a + s.target, 0)}点</b></td></tr>
          </table>
          <hr class="sep">
          <div class="small muted" style="margin-bottom:6px">過去の合格点</div>
          <table class="week">
            ${INFO.passHistory.map(([y, p, r]) => `<tr><th style="width:auto">${y}</th><td>${p}点</td><td class="muted">合格率 ${r}</td></tr>`).join("")}
          </table>
          <p class="tiny" style="margin:10px 0 0">${esc(INFO.note)}</p>
        </div>
      </div>
      ${last.length ? `<div class="section"><div class="section-head"><h2>これまでの模試</h2></div><div class="card">
        ${last.map((m) => `<div class="row" style="justify-content:space-between;padding:6px 0;border-bottom:1px dashed var(--line)">
          <span class="small">${fmtJP(m.date)}　${m.n}問</span>
          <span><b>${m.score}</b> / ${m.n}（${pct(m.score / m.n)}）<span class="badge-pass ${m.pass ? "ok" : "ng"}">${m.pass ? "合格点相当" : "合格点未満"}</span></span>
        </div>`).join("")}
      </div></div>` : ""}
    `;
    app.querySelectorAll("[data-mock]").forEach((b) => b.addEventListener("click", () => {
      const full = b.dataset.mock === "full";
      const mini = { gyo: 8, ken: 6, hou: 3, zei: 3 };
      const ids = SKEYS.flatMap((k) => shuffle(QS.filter((q) => q.s === k)).slice(0, full ? SUBJ[k].count : mini[k]).map((q) => q.id));
      startSession("mock", ids, { limitSec: (full ? INFO.minutes : 50) * 60 });
    }));
  }
  function tickTimer() {
    const el = $("#timer"); if (!el || !session) return;
    const upd = () => {
      const left = session.limitSec - Math.floor((Date.now() - session.startedAt) / 1000);
      if (left <= 0) { clearInterval(timerId); toast("時間になりました"); finishMock(); return; }
      el.textContent = `${Math.floor(left / 60)}:${pad(left % 60)}`;
      el.style.color = left < 300 ? "var(--red)" : "";
    };
    clearInterval(timerId); upd(); timerId = setInterval(upd, 1000);
  }
  function finishMock() {
    clearInterval(timerId);
    const s = session; if (!s || s.finished) return;
    s.finished = true;
    const answered = Object.fromEntries(s.results.map((r) => [r.id, r]));
    s.results.forEach((r) => record(r.id, r.ok));
    const by = {};
    for (const id of s.ids) {
      const q = QMAP[id]; const r = answered[id];
      by[q.s] ||= { n: 0, ok: 0 }; by[q.s].n++; if (r?.ok) by[q.s].ok++;
    }
    const score = Object.values(by).reduce((a, b) => a + b.ok, 0);
    const n = s.ids.length;
    const pass = score / n >= INFO.passRecent / INFO.total;
    const safe = score / n >= INFO.safeLine / INFO.total;
    const as50 = Math.round((score / n) * INFO.total);
    const sec = Math.floor((Date.now() - s.startedAt) / 1000);
    S.mocks.push({ date: today(), n, score, pass, sec, by }); save();

    const wrong = s.ids.filter((id) => !answered[id]?.ok);
    app.innerHTML = `
      <div class="card" style="text-align:center;padding:26px 18px">
        <div class="tiny">模試の結果（${Math.floor(sec / 60)}分${pad(sec % 60)}秒）</div>
        <div class="result-big">${score}<span class="muted" style="font-size:22px"> / ${n}</span></div>
        <div style="margin-top:6px"><span class="badge-pass ${pass ? "ok" : "ng"}">${safe ? "安全圏（50問換算 " + as50 + "点）" : pass ? "直近の合格点相当（50問換算 " + as50 + "点）" : "合格点に届いていません（50問換算 " + as50 + "点）"}</span></div>
        <p class="tiny" style="margin:12px 0 0">直近の合格点は${INFO.passRecent}点（令和7年）。年によって33〜38点の幅があるため、${INFO.safeLine}点以上を安全圏の目安にしています。</p>
      </div>
      <div class="section"><div class="section-head"><h2>科目別</h2><span class="sub">赤線＝科目別の目標点の得点率</span></div>
        <div class="card">${SKEYS.filter((k) => by[k]).map((k) => {
          const r = by[k].ok / by[k].n, line = SUBJ[k].target / SUBJ[k].count;
          return `<div class="sbar"><div class="name"><span class="dot" style="background:${sColor(k)}"></span>${SUBJ[k].name}</div>
            <div class="track"><div class="fill" style="width:${r * 100}%;background:${sColor(k)}"></div><div class="line" style="left:${line * 100}%"></div></div>
            <div class="val">${by[k].ok}/${by[k].n}</div></div>`;
        }).join("")}</div>
      </div>
      ${wrong.length ? `<div class="section"><div class="section-head"><h2>解説を確認する</h2><span class="sub">${wrong.length}問</span></div>
        ${wrong.map((id) => { const q = QMAP[id]; const r = answered[id]; return `<div class="card">
          <div class="qmeta"><span class="dot" style="background:${sColor(q.s)}"></span>${SUBJ[q.s].name}・${esc(q.t)}</div>
          <div class="small" style="margin:6px 0">${esc(q.q)}</div>
          ${r ? `<div class="small"><span class="muted">あなた：</span>${esc(q.c[r.picked])}</div>` : `<div class="small muted">未回答</div>`}
          <div class="small"><span class="muted">正答：</span><b>${esc(q.c[q.a])}</b></div>
          <div class="small muted" style="margin-top:6px">${esc(q.e)}</div></div>`; }).join("")}
      </div>` : ""}
      <div style="margin-top:16px"><a class="btn ghost block" href="#/mock">模試トップへ</a></div>
    `;
    window.scrollTo(0, 0);
  }

  // ───────── 法令ノート ─────────
  let lawQuery = "", lawFilter = "all", hideKeys = false;
  function vLaws() {
    const lawKeys = [...new Set(LAWS.map((l) => l.law))];
    const ql = lawQuery.trim().toLowerCase();
    const list = LAWS.filter((l) => (lawFilter === "all" || l.law === lawFilter) &&
      (!ql || [l.title, l.art, l.body, ...l.keys.flat()].join(" ").toLowerCase().includes(ql)));
    app.innerHTML = `
      <div class="section-head"><h1 style="font-size:22px">条文ノート</h1><a class="btn ghost" href="#/cards" style="padding:7px 12px">数値カード ${CARDS.length}枚</a></div>
      <input class="search" id="lq" type="search" placeholder="キーワードで探す（例：クーリング・オフ、2/10、定期借地）" value="${esc(lawQuery)}">
      <div class="row" style="margin-top:10px" id="lf">
        <button class="chip ${lawFilter === "all" ? "on" : ""}" data-v="all">すべて</button>
        ${lawKeys.map((k) => `<button class="chip ${lawFilter === k ? "on" : ""}" data-v="${k}">${SRC[k].name}</button>`).join("")}
      </div>
      <div class="row" style="margin:12px 0 4px;justify-content:space-between">
        <span class="tiny">${list.length}件</span>
        <button class="chip ${hideKeys ? "on" : ""}" id="hk">数値を隠す</button>
      </div>
      <div id="laws">${list.map(lawCard).join("") || `<div class="empty">見つかりませんでした</div>`}</div>
      <div class="section card small muted">
        「条文を読む」で表示される原文は、e-Gov 法令検索（法令API）から取得したものです（2026年11月7日時点）。宅建試験は、その年の4月1日時点で施行されている法令に基づいて出題されます。<br>
        条文の原文：${Object.values(SRC).map((s) => `<a href="${s.url}" target="_blank" rel="noopener">${s.name}</a>`).join("・")}（e-Gov法令検索）
      </div>
    `;
    const lq = $("#lq");
    lq.addEventListener("input", () => { lawQuery = lq.value; const pos = lq.selectionStart; vLaws(); const n = $("#lq"); n.focus(); n.setSelectionRange(pos, pos); });
    $("#lf").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (!b) return; lawFilter = b.dataset.v; vLaws(); });
    $("#hk").addEventListener("click", () => { hideKeys = !hideKeys; vLaws(); });
    app.querySelectorAll(".key").forEach((k) => k.addEventListener("click", () => k.classList.toggle("hide")));
  }
  function paraLabel(n) {
    const m = String(n).split("-");
    return m.length === 2 ? `${m[0].replace("の", "条の")}${m[0].includes("の") ? "" : "条"} ${m[1]}項` : `${n}項`;
  }
  function lawCard(l) {
    return `<div class="card law">
      <div class="row" style="justify-content:space-between"><span class="art">${SRC[l.law].name} ${esc(l.art)}</span><a class="tiny" href="${SRC[l.law].url}" target="_blank" rel="noopener">条文 ↗</a></div>
      <h3>${esc(l.title)}</h3>
      <p>${esc(l.body)}</p>
      ${l.text ? `<details class="jobun"><summary>条文を読む</summary>${l.text.map(([n, t, items]) => `<div class="para"><span class="pno">${esc(paraLabel(n))}</span><div>${esc(t)}${items.length ? `<ol class="items">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ol>` : ""}</div></div>`).join("")}<div class="tiny">施行日 ${esc(SRC[l.law].enf || "")} 時点の条文（e-Gov 法令API）</div></details>` : ""}
      ${l.keys.length ? `<div class="keys">${l.keys.map(([q, a]) => `<div class="key ${hideKeys ? "hide" : ""}"><span>${esc(q)}</span><span class="ans">${esc(a)}</span></div>`).join("")}</div>` : ""}
    </div>`;
  }

  // ───────── 数値カード ─────────
  let cardDeck = null;
  function vCards() {
    if (!cardDeck || cardDeck.i >= cardDeck.ids.length) {
      // 覚えていないカード優先で20枚
      const sorted = shuffle(CARDS).sort((a, b) => (S.cards[a.id]?.known ? 1 : 0) - (S.cards[b.id]?.known ? 1 : 0));
      cardDeck = { ids: sorted.slice(0, 20).map((c) => c.id), i: 0, open: false, done: cardDeck?.done || 0 };
    }
    const c = CARDS.find((x) => x.id === cardDeck.ids[cardDeck.i]);
    const known = Object.values(S.cards).filter((x) => x.known).length;
    app.innerHTML = `
      <div class="section-head"><h1 style="font-size:22px">数値カード</h1><span class="sub">覚えた ${known} / ${CARDS.length}枚</span></div>
      <div class="progress" style="margin-bottom:12px"><i style="width:${(cardDeck.i / cardDeck.ids.length) * 100}%"></i></div>
      <div class="card flash" id="flash">
        <div class="tiny">${SRC[c.law.law].name} ${esc(c.law.art)}｜${esc(c.law.title)}</div>
        <div class="q" style="margin-top:10px">${esc(c.q)}</div>
        ${cardDeck.open ? `<div class="a">${esc(c.a)}</div>` : `<div class="hint">タップして答えを見る</div>`}
      </div>
      <div class="grid2" style="margin-top:12px">
        <button class="btn quiet" id="again" ${cardDeck.open ? "" : "disabled"}>まだ不安</button>
        <button class="btn" id="got" ${cardDeck.open ? "" : "disabled"}>覚えた</button>
      </div>
      <div class="row" style="margin-top:14px;justify-content:space-between">
        <span class="tiny">今日 ${dayLog().cards}枚</span>
        <a class="tiny" href="#/laws">条文ノートへ戻る</a>
      </div>
    `;
    $("#flash").addEventListener("click", () => { cardDeck.open = !cardDeck.open; vCards(); });
    const next = (knownNow) => {
      const rec = (S.cards[c.id] ||= { n: 0, known: false });
      rec.n++; rec.known = knownNow;
      dayLog().cards++; save();
      cardDeck.i++; cardDeck.open = false;
      if (cardDeck.i >= cardDeck.ids.length) { toast("20枚めくりました。おつかれさまです"); cardDeck = null; }
      else if (dayLog().cards === 5) toast("今日のカード5枚、達成です");
      vCards();
    };
    $("#again").addEventListener("click", () => next(false));
    $("#got").addEventListener("click", () => next(true));
  }

  // ───────── 計画・設定 ─────────
  function vPlan() {
    const exam = S.settings.examDate;
    const left = diffDays(today(), exam);
    const base = addDays(exam, -180), drill = addDays(exam, -60);
    const t = today();
    const phases = [
      { name: "基礎期", from: S.settings.startDate < base ? S.settings.startDate : t, to: addDays(base, -1), body: "全科目を一通り。用語と数値の土台づくり。1日10問＋法令カードで習慣化。", key: "base" },
      { name: "演習期", from: base, to: addDays(drill, -1), body: "過去問レベルの演習で回転数を上げる。間違えた問題は翌日に必ず復習。月1回の模試。", key: "drill" },
      { name: "直前期", from: drill, to: addDays(exam, -1), body: "50問・2時間の模試を毎週。宅建業法で18点以上を固め、数値の総復習。", key: "final" },
      { name: "本試験", from: exam, to: exam, body: "例年10月第3日曜日、13時〜15時の2時間。合格発表は11月下旬。", key: "exam" },
    ];
    const ph = phaseInfo().key;
    const weekRows = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(t, i);
      const f = WEEK_FOCUS[parse(d).getDay()];
      const label = f === "review" ? "復習・ミニ模試" : f === "weak" ? `苦手科目（現在：${SUBJ[weakest()].name}）` : SUBJ[f].name;
      weekRows.push(`<tr class="${i === 0 ? "today" : ""}"><th>${WEEK_LABEL[parse(d).getDay()]}</th><td>${fmtJP(d)}</td><td>${label}</td></tr>`);
    }
    app.innerHTML = `
      <div class="section-head"><h1 style="font-size:22px">学習計画</h1><span class="sub">${left >= 0 ? `試験まで ${left}日（約${Math.ceil(left / 7)}週）` : "試験日を過ぎています"}</span></div>
      <div class="card">
        <div class="phases">${phases.map((p) => {
          const cls = p.key === ph ? "now" : (p.to < t ? "past" : "");
          return `<div class="phase-row ${cls}"><div class="rail"></div><div class="body">
            <b>${p.name}</b> <span class="tiny">${p.key === "exam" ? fmtJP(p.from) : `${fmtJP(p.from)} 〜 ${fmtJP(p.to)}`}</span>
            <div class="small muted">${p.body}</div></div></div>`;
        }).join("")}</div>
      </div>

      <div class="section"><div class="section-head"><h2>この1週間</h2><span class="sub">曜日ごとのテーマ</span></div>
        <div class="card"><table class="week">${weekRows.join("")}</table>
        <p class="tiny" style="margin:10px 0 0">配点の大きい宅建業法（20問）を週2回置いています。土曜はその時点で目標から最も遠い科目を自動で選びます。</p></div>
      </div>

      <div class="section"><div class="section-head"><h2>設定</h2></div>
        <div class="card">
          <label class="field"><span>試験日（例年10月第3日曜日。令和9年度は未発表のため予想日を初期値にしています）</span><input type="date" id="exam" value="${exam}"></label>
          <label class="field"><span>1日の目標問題数</span><input type="number" id="goal" min="1" max="100" value="${S.settings.dailyGoal}"></label>
          <label class="field"><span>表示テーマ</span>
            <select id="theme">${[["auto", "端末に合わせる"], ["light", "ライト"], ["dark", "ダーク"]].map(([v, l]) => `<option value="${v}" ${S.settings.theme === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <button class="btn block" id="saveSet">保存する</button>
        </div>
      </div>

      <div class="section"><div class="section-head"><h2>学習データ</h2><span class="sub">この端末のブラウザに保存されています</span></div>
        <div class="card">
          <p class="small muted" style="margin-top:0">MacとWindowsなど複数の端末で使う場合は、書き出したデータ（ファイル、またはコピーされたテキスト）をもう一方で読み込むと引き継げます。</p>
          <div class="grid2">
            <button class="btn ghost" id="exp">書き出す</button>
            <label class="btn ghost" style="cursor:pointer">読み込む<input type="file" id="imp" accept="application/json" hidden></label>
          </div>
          <textarea id="dataBox" class="search" rows="4" hidden style="margin-top:10px;font-size:12px" placeholder="書き出したテキストをここに貼り付け"></textarea>
          <button class="btn quiet block" id="impText" style="margin-top:10px">貼り付けたテキストから読み込む</button>
          <button class="btn quiet block" id="reset" style="margin-top:10px">すべての記録を消す</button>
        </div>
      </div>

      <div class="section card small muted">
        収録問題は過去の本試験の頻出論点をもとにしたオリジナル問題です（宅建業法30・権利関係25・法令上の制限22・税その他23問）。本試験の過去問は、試験実施機関の<a href="https://www.retio.or.jp/exam/past_ques_ans/other/" target="_blank" rel="noopener">一般財団法人 不動産適正取引推進機構の「過去の試験問題」</a>で公開されている問題で解いてください。法令は改正されることがあるため、最新の条文で確認してください。
      </div>
    `;
    $("#saveSet").addEventListener("click", () => {
      const e = $("#exam").value, g = Number($("#goal").value);
      if (e) S.settings.examDate = e;
      if (g > 0) S.settings.dailyGoal = Math.min(100, Math.round(g));
      S.settings.theme = $("#theme").value;
      save(); applyTheme(); toast("保存しました"); route();
    });
    $("#exp").addEventListener("click", async () => {
      const json = JSON.stringify(S);
      const box = $("#dataBox"); box.hidden = false; box.value = json; box.select();
      try {
        const blob = new Blob([JSON.stringify(S, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = `takken-study-${today()}.json`; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      } catch {}
      try { await navigator.clipboard.writeText(json); toast("データをコピーしました（ファイルにも保存されます）"); }
      catch { toast("下の欄のテキストをコピーして保存してください"); }
    });
    const importData = async (text) => {
      try {
        const data = JSON.parse(text);
        if (!data.answers || !data.settings) throw new Error();
        if (!(await ask("読み込んだデータで、この端末の記録を置き換えます。よろしいですか？", "置き換える"))) return;
        S = Object.assign(defaults(), data); save(); applyTheme(); toast("読み込みました"); route();
      } catch { toast("このデータは読み込めませんでした"); }
    };
    $("#imp").addEventListener("change", async (e) => { const f = e.target.files[0]; if (f) importData(await f.text()); });
    $("#impText").addEventListener("click", () => { const v = $("#dataBox").value.trim(); if (!v) { $("#dataBox").hidden = false; toast("書き出したテキストを欄に貼り付けてから押してください"); return; } importData(v); });
    $("#reset").addEventListener("click", async () => {
      if (!(await ask("回答履歴・模試・カードの記録をすべて消します。元に戻せません。よろしいですか？", "消す"))) return;
      const keep = S.settings; S = defaults(); S.settings = keep; save(); toast("記録を消しました"); route();
    });
  }

  // ───────── 起動 ─────────
  applyTheme();
  if (!location.hash) location.hash = "#/today";
  route();
})();
