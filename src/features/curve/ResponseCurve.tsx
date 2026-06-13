import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Frequency response curve (uPlot).
 * STUB: the CURVE agent renders the magnitude response from useEqStore.
 */
export function ResponseCurve() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Response</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Frequency response curve goes here.
      </CardContent>
    </Card>
  );
}

export default ResponseCurve;
