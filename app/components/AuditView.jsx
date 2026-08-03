"use client";
import { ClipboardList } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "./DashboardView";
export function AuditView() { const [writes, setWrites] = useState([]); useEffect(() => { fetch("/api/google/audit").then((r) => r.json()).then((d) => setWrites(d.writes || [])).catch(() => {}); }, []); return <><PageHeader eyebrow="Google Sheets / Audit" title="Sheet audit" subtitle="Review every worklog write made by this app." /><div className="page-scroll"><section className="panel audit-page">{!writes.length ? <div className="empty-state"><ClipboardList size={22} /><strong>No Sheet writes recorded</strong></div> : <div className="audit-list">{writes.map((write) => <div className="audit-row" key={write.id}><strong>{write.workDate}</strong><span>{write.action} · row {write.rowNumber} · {write.tab}</span><time>{new Date(write.createdAt).toLocaleString()}</time></div>)}</div>}</section></div></>; }
