"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="tool-page page-width">
      <div className="tool-heading">
        <h1>Something interrupted this page.</h1>
        <p>Try opening it again. Documents are not saved between sessions.</p>
      </div>
      <button className="btn btn-primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
