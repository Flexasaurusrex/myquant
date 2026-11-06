import Header from "@/components/Header";
import Scanning from "@/components/Scanning";

export default function Loading() {
  return (
    <main className="wrap">
      <Header />
      <div style={{ marginTop: 18 }}><Scanning /></div>
    </main>
  );
}
