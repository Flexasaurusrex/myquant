import Link from "next/link";

export default function Header() {
  return (
    <header className="top">
      <Link href="/" className="brand" aria-label="MyQuant home">
        <span className="logo" aria-hidden>Q</span>
        <span className="wordmark">My<span>Quant</span></span>
      </Link>
      <span className="live"><i aria-hidden /> Live on Robinhood Chain</span>
    </header>
  );
}
