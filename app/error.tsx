"use client";

import { Button, Card } from "@/components/ui";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <Card className="mx-auto mt-16 max-w-md text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-1 break-words text-sm text-muted">{error.message || "An unexpected error occurred."}</p>
      <Button variant="primary" className="mt-4" onClick={() => retry()}>
        Try again
      </Button>
    </Card>
  );
}
