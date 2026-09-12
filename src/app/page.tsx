import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  FileText,
  Files,
  FileInput,
  FileOutput,
  PenLine,
  MousePointer2,
  Type,
  Highlighter,
  ShieldCheck,
  Zap,
  Monitor,
  Sparkle,
} from "lucide-react";

const tools = [
  {
    href: "/edit",
    title: "Edit PDF",
    description: "A quick note. A highlight. A finishing touch. Make your PDF your own.",
    action: "Start editing",
    icon: FileText,
    color: "mint",
  },
  {
    href: "/merge",
    title: "Merge PDF",
    description: "Bring your documents together in one neatly ordered PDF.",
    action: "Merge files",
    icon: Files,
    color: "blue",
  },
  {
    href: "/word-to-pdf",
    title: "Word to PDF",
    description: "Turn your Word document into a PDF that’s ready to share.",
    action: "Convert Word",
    icon: FileInput,
    color: "peach",
  },
  {
    href: "/pdf-to-word",
    title: "PDF to Word",
    description: "Turn a text-based PDF into an editable Word document.",
    action: "Convert PDF",
    icon: FileOutput,
    color: "lavender",
  },
  {
    href: "/sign",
    title: "Sign PDF",
    description: "Draw, type or upload your signature. Place it and you’re done.",
    action: "Add a signature",
    icon: PenLine,
    color: "yellow",
  },
];

export default function Home() {
  return (
    <>
      <section className="hero page-width">
        <div className="hero-copy">
          <div className="pill">
            <span className="status-dot" /> SMALL TOOLS. LESS PAPERWORK.
          </div>
          <h1>
            PDF editing
            <br />
            without the
            <br />
            <span>headache.</span>
          </h1>
          <p>
            Edit, merge, convert and sign your PDFs in one place.
            <br className="desktop-only" /> Everyday documents, made easy.
          </p>
          <div className="hero-actions">
            <Link className="btn btn-primary" href="/edit">
              Edit a PDF <ArrowUpRight size={18} />
            </Link>
            <a className="btn btn-secondary" href="#tools">
              Explore PDF tools <ArrowRight size={17} />
            </a>
          </div>
          <div className="hero-checks">
            <span>
              <Check size={15} /> Free to use
            </span>
            <span>
              <Check size={15} /> No sign-up
            </span>
            <span>
              <Check size={15} /> Temporary uploads deleted
            </span>
          </div>
        </div>
        <div
          className="hero-art"
          aria-label="Illustration of a document with text, highlights and a signature"
          role="img"
        >
          <div className="art-grid" />
          <div className="art-label">
            <span className="status-dot" /> A FEW CLICKS. ALL SORTED.
          </div>
          <div className="preview-window">
            <div className="preview-top">
              <span className="window-dots">
                <i />
                <i />
                <i />
              </span>
              <span>the-next-big-thing.pdf</span>
              <span className="preview-saved">
                <Check size={12} /> Saved
              </span>
            </div>
            <div className="preview-body">
              <div className="preview-rail">
                <MousePointer2 size={18} />
                <span>
                  <Type size={18} />
                </span>
                <PenLine size={18} />
                <Highlighter size={18} />
              </div>
              <div className="preview-paper">
                <div className="paper-kicker">GOOD THINGS START HERE</div>
                <div className="paper-title">A fresh perspective.</div>
                <div className="paper-rule" />
                <div className="paper-line long" />
                <div className="paper-line" />
                <div className="paper-highlight">
                  <div className="paper-line long" />
                </div>
                <div className="paper-line short" />
                <div className="paper-edit">
                  Make it happen.
                  <span />
                </div>
                <div className="paper-line" />
                <div className="paper-line long" />
                <div className="paper-signature">Alex Morgan</div>
                <div className="paper-sign-line" />
                <div className="paper-caption">A LITTLE SIGNATURE. A BIG NEXT STEP.</div>
              </div>
            </div>
            <div className="preview-bottom">
              <span>Page 1 of 3</span>
              <span>− &nbsp; 100% &nbsp; +</span>
            </div>
          </div>
          <div className="art-note">
            <span>
              <Check size={20} />
            </span>
            <div>
              Ready for whatever’s next.<small>Your document. Your finishing touch.</small>
            </div>
          </div>
          <div className="art-scribble">
            less fuss, more done <ArrowUpRight size={19} />
          </div>
        </div>
      </section>
      <section className="tools-section page-width" id="tools">
        <div className="section-heading">
          <div>
            <div className="eyebrow">YOUR EVERYDAY TOOLKIT</div>
            <h2>One place. Five simple tools.</h2>
          </div>
          <p>Pick a tool. Add your file. Get on with your day.</p>
        </div>
        <div className="tool-grid">
          {tools.map((tool) => (
            <Link href={tool.href} className="tool-card" key={tool.href}>
              <span className={`tool-icon ${tool.color}`}>
                <tool.icon size={24} strokeWidth={1.7} />
              </span>
              <h3>{tool.title}</h3>
              <p>{tool.description}</p>
              <span className="card-action">
                {tool.action}
                <ArrowUpRight size={17} />
              </span>
            </Link>
          ))}
        </div>
      </section>
      <section className="why-section page-width">
        <div className="why-intro">
          <div className="eyebrow">LESS COMPLICATED. MORE USEFUL.</div>
          <h2>Why SimplePDF?</h2>
          <p>
            Simple PDF tools for everyday documents.
            <br />
            Just what you need to get it done.
          </p>
        </div>
        <div className="why-grid">
          <div>
            <Sparkle size={21} />
            <h3>Easy from the first click</h3>
            <p>A clear workspace, without the learning curve.</p>
          </div>
          <div>
            <Zap size={21} />
            <h3>Keep things moving</h3>
            <p>Edit, merge and sign with simple, focused tools.</p>
          </div>
          <div>
            <ShieldCheck size={21} />
            <h3>Your files, your business</h3>
            <p>No accounts or tracking. Server-processed files are temporary.</p>
          </div>
          <div>
            <Monitor size={21} />
            <h3>No complicated software</h3>
            <p>One familiar workflow: upload, edit, download.</p>
          </div>
        </div>
      </section>
      <section className="bottom-cta page-width">
        <div>
          <h2>That PDF isn’t going to edit itself.</h2>
          <p>Let’s make this the easy part of your day.</p>
        </div>
        <Link className="btn btn-primary" href="/edit">
          Let’s get it done <ArrowRight size={18} />
        </Link>
      </section>
    </>
  );
}
