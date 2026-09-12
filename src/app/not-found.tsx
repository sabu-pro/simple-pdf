import Link from "next/link";
export default function NotFound() {
  return (
    <div className="tool-page page-width">
      <div className="tool-heading">
        <div className="eyebrow">404</div>
        <h1>This page slipped out of the folder.</h1>
        <p>Find the document tool you need on the homepage.</p>
      </div>
      <Link href="/" className="btn btn-primary">
        Back to all tools
      </Link>
    </div>
  );
}
