"use client";
import { ArrowRight, CheckCircle2, X } from "lucide-react";

const steps = [
  ["Choose activity source", "Use GitHub activity or committed work from local repositories.", "github"],
  ["Add credentials", "Enter Gemini and, when needed, GitHub credentials.", "credentials"],
  ["Connect Google Sheets", "Connect Google and choose the current worklog sheet.", "google"],
  ["Run setup check", "Verify every connection before generating a worklog.", "health"],
];

export function FirstRunWizard({ step, onStepChange, onOpenSettings, onDismiss }) {
  const current = steps[step];
  return <div className="wizard-backdrop"><section className="wizard-card" role="dialog" aria-modal="true"><button className="wizard-close" aria-label="Skip setup" type="button" onClick={onDismiss}><X size={16} /></button><p className="page-eyebrow">First-run setup</p><h2>Connect once. Generate daily.</h2><p className="wizard-copy">Complete these quick steps. You can change everything later in Settings.</p><div className="wizard-progress">{steps.map((item, index) => <button className={index === step ? "active" : index < step ? "complete" : ""} aria-label={`Step ${index + 1}`} key={item[0]} type="button" onClick={() => onStepChange(index)}><span>{index < step ? <CheckCircle2 size={14} /> : index + 1}</span></button>)}</div><div className="wizard-step"><span>Step {step + 1} of {steps.length}</span><h3>{current[0]}</h3><p>{current[1]}</p><button className="primary-action" type="button" onClick={() => onOpenSettings(current[2])}>Open {current[2] === "health" ? "Setup Check" : "Settings"}<ArrowRight size={15} /></button></div><button className="wizard-skip" type="button" onClick={onDismiss}>Skip for now</button></section></div>;
}
