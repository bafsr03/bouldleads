import Link from "next/link";
import { Button, Card } from "@/components/ui";

export default function NotFound() {
  return (
    <Card className="mx-auto mt-16 max-w-md text-center">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="mt-1 text-sm text-muted">That page doesn&apos;t exist, or the campaign was deleted.</p>
      <Link href="/" className="mt-4 inline-block">
        <Button variant="primary">Back to overview</Button>
      </Link>
    </Card>
  );
}
