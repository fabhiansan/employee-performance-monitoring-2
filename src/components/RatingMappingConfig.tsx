import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Plus, Trash2, AlertCircle } from 'lucide-react';
import type { CreateRatingMapping } from '@/types/models';
import { getDefaultRatingMappings } from '@/lib/api';

interface RatingMappingConfigProps {
  uniqueValues: string[];
  onComplete: (mappings: CreateRatingMapping[]) => void;
  onBack: () => void;
}

export function RatingMappingConfig({ uniqueValues, onComplete, onBack }: RatingMappingConfigProps) {
  const [mappings, setMappings] = useState<CreateRatingMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [unmappedValues, setUnmappedValues] = useState<string[]>([]);

  useEffect(() => {
    void loadDefaultMappings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const mapped = new Set(mappings.map(m => m.text_value));
    setUnmappedValues(uniqueValues.filter(v => !mapped.has(v)));
  }, [mappings, uniqueValues]);

  const loadDefaultMappings = async () => {
    try {
      const defaults = await getDefaultRatingMappings();
      // Only keep defaults that match unique values from CSV
      const relevantDefaults = defaults.filter(d =>
        uniqueValues.some(v => v.toLowerCase() === d.text_value.toLowerCase())
      );
      setMappings(relevantDefaults);
    } catch (error) {
      console.error('Failed to load default mappings:', error);
    } finally {
      setLoading(false);
    }
  };

  const addMapping = (textValue: string, numericValue?: number) => {
    const newMapping: CreateRatingMapping = {
      dataset_id: 0,
      text_value: textValue,
      numeric_value: numericValue ?? 0,
    };
    setMappings([...mappings, newMapping]);
  };

  const updateMapping = (index: number, field: 'text_value' | 'numeric_value', value: string | number) => {
    const updated = [...mappings];
    if (field === 'numeric_value') {
      updated[index][field] = typeof value === 'number' ? value : parseFloat(value.toString()) || 0;
    } else {
      updated[index][field] = value as string;
    }
    setMappings(updated);
  };

  const removeMapping = (index: number) => {
    setMappings(mappings.filter((_, i) => i !== index));
  };

  const handleComplete = () => {
    if (unmappedValues.length === 0 || confirm('Some values are unmapped. Continue anyway?')) {
      onComplete(mappings);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-muted-foreground">Loading default mappings...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Configure Rating Mappings</CardTitle>
          <CardDescription>
            Map text ratings to numeric values. Default mappings have been applied where possible.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {unmappedValues.length > 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>Unmapped values:</strong> {unmappedValues.join(', ')}
                <br />
                Add mappings below or these values will have no numeric score.
              </AlertDescription>
            </Alert>
          )}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Text Value</TableHead>
                  <TableHead className="w-32">Numeric Value</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mappings.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      No mappings configured
                    </TableCell>
                  </TableRow>
                ) : (
                  mappings.map((mapping, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <Input
                          value={mapping.text_value}
                          onChange={(e) => updateMapping(index, 'text_value', e.target.value)}
                          placeholder="e.g., Baik"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.1"
                          value={mapping.numeric_value}
                          onChange={(e) => updateMapping(index, 'numeric_value', e.target.value)}
                          placeholder="0"
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeMapping(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => addMapping('', 0)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Mapping
            </Button>
            {unmappedValues.map((value) => (
              <Button
                key={value}
                variant="secondary"
                size="sm"
                onClick={() => addMapping(value)}
              >
                + {value}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-4">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={handleComplete}>
          Continue to Validation
        </Button>
      </div>
    </div>
  );
}
