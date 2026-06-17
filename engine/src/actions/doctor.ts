import { runDoctor, printDoctorReport } from '../doctor.js';

export function runDoctorAction(cwd: string, json = false): void {
  const doctorResult = runDoctor(cwd);
  if (json) {
    console.log(JSON.stringify({
      action: 'doctor',
      cwd: doctorResult.cwd,
      toolVersion: doctorResult.toolVersion,
      checks: doctorResult.checks,
      criticalFailures: doctorResult.criticalFailures,
      warnings: doctorResult.warnings,
    }));
    if (doctorResult.criticalFailures > 0) process.exit(1);
    return;
  }
  const exitCode = printDoctorReport(doctorResult);
  if (exitCode !== 0) process.exit(exitCode);
}
