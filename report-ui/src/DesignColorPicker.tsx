"use client";
export function DesignColorPicker({ config }: { config: { label: string; color?: string; fallback: string; onChange: (color?: string) => void } }) {
  return <details className="design-color">
    <summary aria-label={config.label} title={config.label}><i style={{ background: config.color ?? config.fallback }} /></summary>
    <div className="design-color-picker">
      <label>Color <input type="color" aria-label={`Choose ${config.label.toLowerCase()}`} value={config.color ?? "#168aad"} onChange={(event) => config.onChange(event.target.value)} /></label>
      <button type="button" onClick={() => config.onChange()}>Theme default</button>
    </div>
  </details>;
}
