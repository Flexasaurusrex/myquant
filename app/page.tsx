import Grid from "@/components/Grid";
import Header from "@/components/Header";

export default function Home() {
  return (
    <main className="wrap">
      <Header />
      <section className="hero">
        <h1>Is this token <em>safe?</em></h1>
        <p>Every token trading on Robinhood Chain, checked live. Contract red flags, whale moves, buyer vibes and liquidity on one simple card.</p>
      </section>
      <Grid />
      <p className="foot">
        Not financial advice. Safety checks are automated (contract scan by GoPlus, markets by GeckoTerminal, transfers from Robinhood Chain) and can miss things. A green card means no known red flags, not a promise the price goes up.
      </p>
    </main>
  );
}
