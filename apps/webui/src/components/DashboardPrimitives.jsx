import React from 'react';

export function Panel({ title, actions = null, children }) {
  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-300">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function StatTile({ label, value, tone = 'default' }) {
  const bgClass = tone === 'nested' ? 'bg-gray-950' : 'bg-gray-900';
  return (
    <div className={`rounded border border-gray-800 ${bgClass} px-3 py-2`}>
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-gray-100">{value}</div>
    </div>
  );
}

export function ErrorBanner({ message }) {
  if (!message) {
    return null;
  }

  return (
    <div className="mb-3 rounded border border-red-500/50 bg-red-950/50 p-2 text-xs text-red-200">
      {message}
    </div>
  );
}

export function SuccessBanner({ message }) {
  if (!message) {
    return null;
  }

  return (
    <div className="mb-3 rounded border border-green-500/50 bg-green-950/40 p-2 text-xs text-green-100">
      {message}
    </div>
  );
}

export function JsonDetails({ title, value, maxHeightClass = 'max-h-48' }) {
  return (
    <details className="rounded border border-gray-800 bg-gray-950 p-2">
      <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-gray-400">
        {title}
      </summary>
      <pre className={`mt-2 ${maxHeightClass} overflow-auto whitespace-pre-wrap break-words text-xs text-green-200`}>
        {JSON.stringify(value || {}, null, 2)}
      </pre>
    </details>
  );
}

export function SecondaryButton({ children, className = '', ...props }) {
  return (
    <button
      type="button"
      className={`rounded bg-gray-800 px-2 py-1 text-xs text-gray-100 hover:bg-gray-700 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
