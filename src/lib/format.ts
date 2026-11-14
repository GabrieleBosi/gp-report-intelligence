export function quarterLabel(isoDate: string): string {
  const [year, month] = isoDate.split("-").map(Number);
  return `Q${Math.ceil((month ?? 1) / 3)} ${year}`;
}

export function fileSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
