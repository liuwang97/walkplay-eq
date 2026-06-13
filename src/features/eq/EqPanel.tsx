import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * EQ editor panel — sliders for the 10 bands + preamp.
 * STUB: the EQ agent implements the real controls (reads/writes useEqStore).
 */
export function EqPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Equalizer</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        EQ band controls go here.
      </CardContent>
    </Card>
  );
}

export default EqPanel;
