import Header from "@/components/Header";
import TokenDetail from "@/components/TokenDetail";

export default async function TokenPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return (
    <main className="wrap">
      <Header />
      <TokenDetail address={address.toLowerCase()} />
    </main>
  );
}
