"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <CardTitle>Algo salió mal</CardTitle>
          </div>
          <CardDescription>
            Ocurrió un error inesperado en la aplicación
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted p-3 rounded-md">
            <p className="text-sm font-mono text-muted-foreground">
              {error.message || "Error desconocido"}
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => reset()}>Intentar de nuevo</Button>
            <Button variant="outline" onClick={() => window.location.href = "/"}>
              Volver al inicio
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
