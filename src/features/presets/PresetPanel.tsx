import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Preset browser — built-in / custom / online / shared presets.
 * STUB: the PRESETS agent lists presets and wires applyPreset from useEqStore.
 */
export function PresetPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Presets</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Preset list goes here.
      </CardContent>
    </Card>
  );
}

export default PresetPanel;
