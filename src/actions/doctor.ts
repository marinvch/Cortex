import { runDoctor, printDoctorReport } from '../doctor.js';

export function runDoctorAction(cwd: string): void {
  const doctorResult = runDoctor(cwd);
  const exitCode = printDoctorReport(doctorResult);
  if (exitCode !== 0) process.exit(exitCode);
}
