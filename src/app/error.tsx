"use client";
import { useEffect } from "react";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("Document page failed", error);
  }, [error]);
  return (
    <div className="tool-page page-width">
      <div className="tool-heading">
        <h1>Something interrupted this page.</h1>
        <p>Try opening it again. Documents are not saved between sessions.</p>
      </div>
      <button className="btn btn-primary" onClick={retry}>
        Try again
      </button>
    </div>
  );
}
