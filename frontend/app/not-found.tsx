"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Home, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle className="text-4xl">404</CardTitle>
          <CardDescription className="text-lg">
            Página no encontrada
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            La página que buscas no existe o ha sido movida.
          </p>
          <div className="flex gap-2">
            <Link href="/">
              <Button>
                <Home className="h-4 w-4 mr-2" />
                Volver al inicio
              </Button>
            </Link>
            <Button variant="outline" onClick={() => window.history.back()}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Atrás
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
