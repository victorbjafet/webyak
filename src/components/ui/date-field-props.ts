/**
 * The props both `date-field.tsx` and `date-field.web.tsx` implement.
 *
 * **In its own module on purpose.** A `.web` file cannot import from its own
 * bare specifier — `./date-field` resolves back to itself on web — so anything
 * the two platform files share has to live somewhere neither of them is.
 * See docs/ARCHITECTURE.md#-a-platform-split-hides-missing-exports-from-the-compiler.
 */
export interface DateFieldProps {
  label?: string;
  /** `YYYY-MM-DD`, or empty for unset. */
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
}
