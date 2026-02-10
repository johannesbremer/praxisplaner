This is a `TanStack Start` + `Convex` project.

## Before You Start

- Understand that this project is not yet deployed to production and we are free to make breaking changes in favour of simplicity and correctness.

## Required Before Each Commit

- Run the `Verify CI checks don't fail.` tool.

## Repository Structure

- `components/ui`: Shadcn UI components
- `convex`: Convex schema and functions
- `src`: Main application code (`components/`,`routes/`, `tests/`, `types/`, etc)

## Notes

- Please don't take shortcuts like `eslint-disable`. We have chosen this structure to enable e2e type safety from the DB (Convex) to the UI (TanStack Form). Fully leverage this by using modern TypeScript features and type narrowing etc like a TypeScript Wizard would.
- In the `Agent Notes` section below you should add / edit and remove any notes about the codebase for future agents.

<-- Agent Notes -->

# OCC and Atomicity

In [Queries](/functions/query-functions.md), we mentioned that determinism was important in the way optimistic concurrency control (OCC) was used within Convex. In this section, we'll dive much deeper into _why_.

## Convex Financial, Inc.[​](#convex-financial-inc "Direct link to Convex Financial, Inc.")

Imagine that you're building a banking app, and therefore your databases stores accounts with balances. You want your users to be able to give each other money, so you write a mutation function that transfers funds from one user's account to another.

One run of that transaction might read Alice's account balance, and then Bob's. You then propose to deduct $5 from Alice's account and increase Bob's balance by the same $5.

Here's our pseudocode:

```
$14 <- READ Alice
$11 <- READ Bob
WRITE Alice $9
WRITE Bob $16
```

This ledger balance transfer is a classic database scenario that requires a guarantee that these write operations will only apply together. It is a really bad thing if only one operation succeeds!

```
$14 <- READ Alice
$11 <- READ Bob
WRITE Alice $9
*crash* // $5 lost from your bank
```

You need a guarantee that this can never happen. You require transaction atomicity, and Convex provides it.

The problem of data correctness is much deeper. Concurrent transactions that read and edit the same records can create _data races_.

In the case of our app it's entirely possible that someone deducts Alice's balance right after we read it. Maybe she bought a Coke Zero at the airport with her debit card for $3.

```
$5 Transfer                           $3 Debit Card Charge
----------------------------------------------------------
$14 <- READ Alice
$11 <- READ Bob
                                        $14 <- READ Alice
                                        WRITE Alice $11
WRITE Alice $9 // Free coke!
WRITE Bob $16
```

Clearly, we need to prevent these types of data races from happening. We need a way to handle these concurrent conflicts. Generally, there are two common approaches.

Most traditional databases choose a _pessimistic locking_ strategy. (Pessimism in this case means the strategy assumes conflict will happen ahead of time so seeks to prevent it.) With pessimistic locking, you first need to acquire a lock on Alice's record, and then acquire a lock on Bob's record. Then you can proceed to conduct your transaction, knowing that any other transaction that needed to touch those records will wait until you are done and all your writes are committed.

After decades of experience, the drawbacks of pessimistic locking are well understood and undeniable. The biggest limitation arises from real-life networks and computers being inherently unreliable. If the lock holder goes missing for whatever reason half way through its transaction, everyone else that wants to modify any of those records is waiting indefinitely. Not good!

Optimistic concurrency control is, as the name states, optimistic. It assumes the transaction will succeed and doesn't worry about locking anything ahead of time. Very brash! How can it be so sure?

It does this by treating the transaction as a _declarative proposal_ to write records on the basis of any read record versions (the "read set"). At the end of the transaction, the writes all commit if every version in the read set is still the latest version of that record. This means no concurrent conflict occurred.

Now using our version read set, let's see how OCC would have prevented the soda-catastrophe above:

```
$5 Transfer                           $3 Debit Card Charge
----------------------------------------------------------
(v1, $14) <- READ Alice
(v7, $11) <- READ Bob
                                        (v1, $14) <- READ Alice
                                        WRITE Alice $11
                                        IF Alice.v = v1

WRITE Alice = $9, Bob = $16
    IF Alice.v = v1, Bob.v = v7 // Fails! Alice is = v2
```

This is akin to being unable to push your Git repository because you're not at HEAD. We all know in that circumstance, we need to pull, and rebase or merge, etc.

## When OCC loses, determinism wins[​](#when-occ-loses-determinism-wins "Direct link to When OCC loses, determinism wins")

A naive optimistic concurrency control solution would be to solve this the same way that Git does: require the user/application to resolve the conflict and determine if it is safe to retry.

In Convex, however, we don't need to do that. We know the transaction is deterministic. It didn't charge money to Stripe, it didn't write a permanent value out to the filesystem. It had no effect at all other than proposing some atomic changes to Convex tables that were not applied.

The determinism means that we can simply re-run the transaction; you never need to worry about temporary data races. We can run several retries if necessary until we succeed to execute the transaction without any conflicts.

tip

In fact, the Git analogy stays very apt. An OCC conflict means we cannot push because our HEAD is out of date, so we need to rebase our changes and try again. And determinism is what guarantees there is never a "merge conflict", so (unlike with Git) this rebase operation will always eventually succeed without developer intervention.

## Snapshot Isolation vs Serializability[​](#snapshot-isolation-vs-serializability "Direct link to Snapshot Isolation vs Serializability")

It is common for optimistic multi-version concurrency control databases to provide a guarantee of [snapshot isolation](https://en.wikipedia.org/wiki/Snapshot_isolation). This [isolation level](<https://en.wikipedia.org/wiki/Isolation_(database_systems)>) provides the illusion that all transactions execute on an atomic snapshot of the data but it is vulnerable to [anomalies](https://en.wikipedia.org/wiki/Snapshot_isolation#Definition) where certain combinations of concurrent transactions can yield incorrect results. The implementation of optimistic concurrency control in Convex instead provides true [serializability](https://en.wikipedia.org/wiki/Serializability) and will yield correct results regardless of what transactions are issued concurrently.

## No need to think about this[​](#no-need-to-think-about-this "Direct link to No need to think about this")

The beauty of this approach is that you can simply write your mutation functions as if they will _always succeed_, and always be guaranteed to be atomic.

Aside from sheer curiosity about how Convex works, day to day there's no need to worry about conflicts, locking, or atomicity when you make changes to your tables and documents. The "obvious way" to write your mutation functions will just work.

# Mental Model: Rule Sets

Rule sets should be stored in a **git-like model**.

- When a user saves, they must provide a name for the rule set (similar to a commit message).
- The user can return to any previously saved rule set.
- When the user makes modifications (e.g., changing active rules, documentation, work times, locations, or appointment types), we **do not** update the existing rule set. Instead, we create a new `ungespeichert` rule set, based on the rule set they started editing.
- The user cannot switch to another rule set without first triggering the **"Regelset speichern"** modal, which requires them to either save or discard their changes. This ensures that there is never more than one conflicting `ungespeichert` state.
- Note: The `ungespeichert` state is still persisted in Convex, just like all other rule sets (which can be confusing).

# Build forms in React using shadcn, TanStack Form and Zod

This guide explores how to build forms using TanStack Form. You'll learn to create forms with the `<Field />` component, implement schema validation with Zod, handle errors, and ensure accessibility.

## Demo

We'll start by building the following form. It has a simple text input and a textarea. On submit, we'll validate the form data and display any errors.

<Callout icon={<InfoIcon />}>
**Note:** For the purpose of this demo, we have intentionally disabled browser
validation to show how schema validation and form errors work in TanStack
Form. It is recommended to add basic browser validation in your production
code.
</Callout>

<ComponentPreview
  name="form-tanstack-demo"
  className="sm:[&_.preview]:h-[700px] sm:[&_pre]:!h-[700px]"
  chromeLessOnMobile
/>

## Approach

This form leverages TanStack Form for powerful, headless form handling. We'll build our form using the `<Field />` component, which gives you **complete flexibility over the markup and styling**.

- Uses TanStack Form's `useForm` hook for form state management.
- `form.Field` component with render prop pattern for controlled inputs.
- `<Field />` components for building accessible forms.
- Client-side validation using Zod.
- Real-time validation feedback.

## Anatomy

Here's a basic example of a form using TanStack Form with the `<Field />` component.

```tsx showLineNumbers {15-31}
<form
  onSubmit={(e) => {
    e.preventDefault();
    form.handleSubmit();
  }}
>
  <FieldGroup>
    <form.Field
      name="title"
      children={(field) => {
        const isInvalid =
          field.state.meta.isTouched && !field.state.meta.isValid;
        return (
          <Field data-invalid={isInvalid}>
            <FieldLabel htmlFor={field.name}>Bug Title</FieldLabel>
            <Input
              id={field.name}
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              aria-invalid={isInvalid}
              placeholder="Login button not working on mobile"
              autoComplete="off"
            />
            <FieldDescription>
              Provide a concise title for your bug report.
            </FieldDescription>
            {isInvalid && <FieldError errors={field.state.meta.errors} />}
          </Field>
        );
      }}
    />
  </FieldGroup>
  <Button type="submit">Submit</Button>
</form>
```

## Form

### Create a schema

We'll start by defining the shape of our form using a Zod schema.

<Callout icon={<InfoIcon />}>
**Note:** This example uses `zod v3` for schema validation. TanStack Form
integrates seamlessly with Zod and other Standard Schema validation libraries
through its validators API.
</Callout>

```tsx showLineNumbers title="form.tsx"
import * as z from "zod";

const formSchema = z.object({
  title: z
    .string()
    .min(5, "Bug title must be at least 5 characters.")
    .max(32, "Bug title must be at most 32 characters."),
  description: z
    .string()
    .min(20, "Description must be at least 20 characters.")
    .max(100, "Description must be at most 100 characters."),
});
```

### Setup the form

Use the `useForm` hook from TanStack Form to create your form instance with Zod validation.

```tsx showLineNumbers title="form.tsx" {10-21}
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import * as z from "zod";

const formSchema = z.object({
  // ...
});

export function BugReportForm() {
  const form = useForm({
    defaultValues: {
      title: "",
      description: "",
    },
    validators: {
      onSubmit: formSchema,
    },
    onSubmit: async ({ value }) => {
      toast.success("Form submitted successfully");
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      {/* ... */}
    </form>
  );
}
```

We are using `onSubmit` to validate the form data here. TanStack Form supports other validation modes, which you can read about in the [documentation](https://tanstack.com/form/latest/docs/framework/react/guides/dynamic-validation).

### Build the form

We can now build the form using the `form.Field` component from TanStack Form and the `<Field />` component.

<ComponentSource
  src="/registry/new-york-v4/examples/form-tanstack-demo.tsx"
  title="form.tsx"
/>

### Done

That's it. You now have a fully accessible form with client-side validation.

When you submit the form, the `onSubmit` function will be called with the validated form data. If the form data is invalid, TanStack Form will display the errors next to each field.

## Validation

### Client-side Validation

TanStack Form validates your form data using the Zod schema. Validation happens in real-time as the user types.

```tsx showLineNumbers title="form.tsx" {13-15}
import { useForm } from "@tanstack/react-form";

const formSchema = z.object({
  // ...
});

export function BugReportForm() {
  const form = useForm({
    defaultValues: {
      title: "",
      description: "",
    },
    validators: {
      onSubmit: formSchema,
    },
    onSubmit: async ({ value }) => {
      console.log(value);
    },
  });

  return <form onSubmit={/* ... */}>{/* ... */}</form>;
}
```

### Validation Modes

TanStack Form supports different validation strategies through the `validators` option:

| Mode         | Description                          |
| ------------ | ------------------------------------ |
| `"onChange"` | Validation triggers on every change. |
| `"onBlur"`   | Validation triggers on blur.         |
| `"onSubmit"` | Validation triggers on submit.       |

```tsx showLineNumbers title="form.tsx" {6-9}
const form = useForm({
  defaultValues: {
    title: "",
    description: "",
  },
  validators: {
    onSubmit: formSchema,
    onChange: formSchema,
    onBlur: formSchema,
  },
});
```

## Displaying Errors

Display errors next to the field using `<FieldError />`. For styling and accessibility:

- Add the `data-invalid` prop to the `<Field />` component.
- Add the `aria-invalid` prop to the form control such as `<Input />`, `<SelectTrigger />`, `<Checkbox />`, etc.

```tsx showLineNumbers title="form.tsx" {4,18}
<form.Field
  name="email"
  children={(field) => {
    const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

    return (
      <Field data-invalid={isInvalid}>
        <FieldLabel htmlFor={field.name}>Email</FieldLabel>
        <Input
          id={field.name}
          name={field.name}
          value={field.state.value}
          onBlur={field.handleBlur}
          onChange={(e) => field.handleChange(e.target.value)}
          type="email"
          aria-invalid={isInvalid}
        />
        {isInvalid && <FieldError errors={field.state.meta.errors} />}
      </Field>
    );
  }}
/>
```

## Working with Different Field Types

### Input

- For input fields, use `field.state.value` and `field.handleChange` on the `<Input />` component.
- To show errors, add the `aria-invalid` prop to the `<Input />` component and the `data-invalid` prop to the `<Field />` component.

<ComponentPreview
  name="form-tanstack-input"
  className="sm:[&_.preview]:h-[700px] sm:[&_pre]:!h-[700px]"
  chromeLessOnMobile
/>

```tsx showLineNumbers title="form.tsx" {6,11-14,22}
<form.Field
  name="username"
  children={(field) => {
    const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
    return (
      <Field data-invalid={isInvalid}>
        <FieldLabel htmlFor="form-tanstack-input-username">Username</FieldLabel>
        <Input
          id="form-tanstack-input-username"
          name={field.name}
          value={field.state.value}
          onBlur={field.handleBlur}
          onChange={(e) => field.handleChange(e.target.value)}
          aria-invalid={isInvalid}
          placeholder="shadcn"
          autoComplete="username"
        />
        <FieldDescription>
          This is your public display name. Must be between 3 and 10 characters.
          Must only contain letters, numbers, and underscores.
        </FieldDescription>
        {isInvalid && <FieldError errors={field.state.meta.errors} />}
      </Field>
    );
  }}
/>
```

### Textarea

- For textarea fields, use `field.state.value` and `field.handleChange` on the `<Textarea />` component.
- To show errors, add the `aria-invalid` prop to the `<Textarea />` component and the `data-invalid` prop to the `<Field />` component.

<ComponentPreview
  name="form-tanstack-textarea"
  className="sm:[&_.preview]:h-[700px] sm:[&_pre]:!h-[700px]"
  chromeLessOnMobile
/>

```tsx showLineNumbers title="form.tsx" {6,13-16,24}
<form.Field
  name="about"
  children={(field) => {
    const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
    return (
      <Field data-invalid={isInvalid}>
        <FieldLabel htmlFor="form-tanstack-textarea-about">
          More about you
        </FieldLabel>
        <Textarea
          id="form-tanstack-textarea-about"
          name={field.name}
          value={field.state.value}
          onBlur={field.handleBlur}
          onChange={(e) => field.handleChange(e.target.value)}
          aria-invalid={isInvalid}
          placeholder="I'm a software engineer..."
          className="min-h-[120px]"
        />
        <FieldDescription>
          Tell us more about yourself. This will be used to help us personalize
          your experience.
        </FieldDescription>
        {isInvalid && <FieldError errors={field.state.meta.errors} />}
      </Field>
    );
  }}
/>
```

### Select

- For select components, use `field.state.value` and `field.handleChange` on the `<Select />` component.
- To show errors, add the `aria-invalid` prop to the `<SelectTrigger />` component and the `data-invalid` prop to the `<Field />` component.

<ComponentPreview
  name="form-tanstack-select"
  className="sm:[&_.preview]:h-[700px] sm:[&_pre]:!h-[700px]"
  chromeLessOnMobile
/>

```tsx showLineNumbers title="form.tsx" {6,18-19,23}
<form.Field
  name="language"
  children={(field) => {
    const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
    return (
      <Field orientation="responsive" data-invalid={isInvalid}>
        <FieldContent>
          <FieldLabel htmlFor="form-tanstack-select-language">
            Spoken Language
          </FieldLabel>
          <FieldDescription>
            For best results, select the language you speak.
          </FieldDescription>
          {isInvalid && <FieldError errors={field.state.meta.errors} />}
        </FieldContent>
        <Select
          name={field.name}
          value={field.state.value}
          onValueChange={field.handleChange}
        >
          <SelectTrigger
            id="form-tanstack-select-language"
            aria-invalid={isInvalid}
            className="min-w-[120px]"
          >
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent position="item-aligned">
            <SelectItem value="auto">Auto</SelectItem>
            <SelectItem value="en">English</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    );
  }}
/>
```

### Checkbox

- For checkbox, use `field.state.value` and `field.handleChange` on the `<Checkbox />` component.
- To show errors, add the `aria-invalid` prop to the `<Checkbox />` component and the `data-invalid` prop to the `<Field />` component.
- For checkbox arrays, use `mode="array"` on the `<form.Field />` component and TanStack Form's array helpers.
- Remember to add `data-slot="checkbox-group"` to the `<FieldGroup />` component for proper styling and spacing.

<ComponentPreview
  name="form-tanstack-checkbox"
  className="sm:[&_.preview]:h-[700px] sm:[&_pre]:!h-[700px]"
  chromeLessOnMobile
/>

```tsx showLineNumbers title="form.tsx" {12,17,22-24,44}
<form.Field
  name="tasks"
  mode="array"
  children={(field) => {
    const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
    return (
      <FieldSet>
        <FieldLegend variant="label">Tasks</FieldLegend>
        <FieldDescription>
          Get notified when tasks you&apos;ve created have updates.
        </FieldDescription>
        <FieldGroup data-slot="checkbox-group">
          {tasks.map((task) => (
            <Field
              key={task.id}
              orientation="horizontal"
              data-invalid={isInvalid}
            >
              <Checkbox
                id={`form-tanstack-checkbox-${task.id}`}
                name={field.name}
                aria-invalid={isInvalid}
                checked={field.state.value.includes(task.id)}
                onCheckedChange={(checked) => {
                  if (checked) {
                    field.pushValue(task.id);
                  } else {
                    const index = field.state.value.indexOf(task.id);
                    if (index > -1) {
                      field.removeValue(index);
                    }
                  }
                }}
              />
              <FieldLabel
                htmlFor={`form-tanstack-checkbox-${task.id}`}
                className="font-normal"
              >
                {task.label}
              </FieldLabel>
            </Field>
          ))}
        </FieldGroup>
        {isInvalid && <FieldError errors={field.state.meta.errors} />}
      </FieldSet>
    );
  }}
/>
```

### Radio Group

- For radio groups, use `field.state.value` and `field.handleChange` on the `<RadioGroup />` component.
- To show errors, add the `aria-invalid` prop to the `<RadioGroupItem />` component and the `data-invalid` prop to the `<Field />` component.

<ComponentPreview
  name="form-tanstack-radiogroup"
  className="sm:[&_.preview]:h-[700px] sm:[&_pre]:!h-[700px]"
  chromeLessOnMobile
/>

```tsx showLineNumbers title="form.tsx" {21,29,35}
<form.Field
  name="plan"
  children={(field) => {
    const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
    return (
      <FieldSet>
        <FieldLegend>Plan</FieldLegend>
        <FieldDescription>
          You can upgrade or downgrade your plan at any time.
        </FieldDescription>
        <RadioGroup
          name={field.name}
          value={field.state.value}
          onValueChange={field.handleChange}
        >
          {plans.map((plan) => (
            <FieldLabel
              key={plan.id}
              htmlFor={`form-tanstack-radiogroup-${plan.id}`}
            >
              <Field orientation="horizontal" data-invalid={isInvalid}>
                <FieldContent>
                  <FieldTitle>{plan.title}</FieldTitle>
                  <FieldDescription>{plan.description}</FieldDescription>
                </FieldContent>
                <RadioGroupItem
                  value={plan.id}
                  id={`form-tanstack-radiogroup-${plan.id}`}
                  aria-invalid={isInvalid}
                />
              </Field>
            </FieldLabel>
          ))}
        </RadioGroup>
        {isInvalid && <FieldError errors={field.state.meta.errors} />}
      </FieldSet>
    );
  }}
/>
```

### Switch

- For switches, use `field.state.value` and `field.handleChange` on the `<Switch />` component.
- To show errors, add the `aria-invalid` prop to the `<Switch />` component and the `data-invalid` prop to the `<Field />` component.

<ComponentPreview
  name="form-tanstack-switch"
  className="sm:[&_.preview]:h-[500px] sm:[&_pre]:!h-[500px]"
  chromeLessOnMobile
/>

```tsx showLineNumbers title="form.tsx" {6,14,19-21}
<form.Field
  name="twoFactor"
  children={(field) => {
    const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
    return (
      <Field orientation="horizontal" data-invalid={isInvalid}>
        <FieldContent>
          <FieldLabel htmlFor="form-tanstack-switch-twoFactor">
            Multi-factor authentication
          </FieldLabel>
          <FieldDescription>
            Enable multi-factor authentication to secure your account.
          </FieldDescription>
          {isInvalid && <FieldError errors={field.state.meta.errors} />}
        </FieldContent>
        <Switch
          id="form-tanstack-switch-twoFactor"
          name={field.name}
          checked={field.state.value}
          onCheckedChange={field.handleChange}
          aria-invalid={isInvalid}
        />
      </Field>
    );
  }}
/>
```

### Complex Forms

Here is an example of a more complex form with multiple fields and validation.

<ComponentPreview
  name="form-tanstack-complex"
  className="sm:[&_.preview]:h-[1100px] sm:[&_pre]:!h-[1100px]"
  chromeLessOnMobile
/>

## Resetting the Form

Use `form.reset()` to reset the form to its default values.

```tsx showLineNumbers
<Button type="button" variant="outline" onClick={() => form.reset()}>
  Reset
</Button>
```

## Array Fields

TanStack Form provides powerful array field management with `mode="array"`. This allows you to dynamically add, remove, and update array items with full validation support.

<ComponentPreview
  name="form-tanstack-array"
  className="sm:[&_.preview]:h-[700px] sm:[&_pre]:!h-[700px]"
  chromeLessOnMobile
/>

This example demonstrates managing multiple email addresses with array fields. Users can add up to 5 email addresses, remove individual addresses, and each address is validated independently.

### Array Field Structure

Use `mode="array"` on the parent field to enable array field management.

```tsx showLineNumbers title="form.tsx" {3,12-14}
<form.Field
  name="emails"
  mode="array"
  children={(field) => {
    return (
      <FieldSet>
        <FieldLegend variant="label">Email Addresses</FieldLegend>
        <FieldDescription>
          Add up to 5 email addresses where we can contact you.
        </FieldDescription>
        <FieldGroup>
          {field.state.value.map((_, index) => (
            // Nested field for each array item
          ))}
        </FieldGroup>
      </FieldSet>
    )
  }}
/>
```

### Nested Fields

Access individual array items using bracket notation: `fieldName[index].propertyName`. This example uses `InputGroup` to display the remove button inline with the input.

```tsx showLineNumbers title="form.tsx"
<form.Field
  name={`emails[${index}].address`}
  children={(subField) => {
    const isSubFieldInvalid =
      subField.state.meta.isTouched && !subField.state.meta.isValid;
    return (
      <Field orientation="horizontal" data-invalid={isSubFieldInvalid}>
        <FieldContent>
          <InputGroup>
            <InputGroupInput
              id={`form-tanstack-array-email-${index}`}
              name={subField.name}
              value={subField.state.value}
              onBlur={subField.handleBlur}
              onChange={(e) => subField.handleChange(e.target.value)}
              aria-invalid={isSubFieldInvalid}
              placeholder="name@example.com"
              type="email"
            />
            {field.state.value.length > 1 && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => field.removeValue(index)}
                  aria-label={`Remove email ${index + 1}`}
                >
                  <XIcon />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
          {isSubFieldInvalid && (
            <FieldError errors={subField.state.meta.errors} />
          )}
        </FieldContent>
      </Field>
    );
  }}
/>
```

### Adding Items

Use `field.pushValue(item)` to add items to an array field. You can disable the button when the array reaches its maximum length.

```tsx showLineNumbers title="form.tsx"
<Button
  type="button"
  variant="outline"
  size="sm"
  onClick={() => field.pushValue({ address: "" })}
  disabled={field.state.value.length >= 5}
>
  Add Email Address
</Button>
```

### Removing Items

Use `field.removeValue(index)` to remove items from an array field. You can conditionally show the remove button only when there's more than one item.

```tsx showLineNumbers title="form.tsx"
{
  field.state.value.length > 1 && (
    <InputGroupButton
      onClick={() => field.removeValue(index)}
      aria-label={`Remove email ${index + 1}`}
    >
      <XIcon />
    </InputGroupButton>
  );
}
```

### Array Validation

Validate array fields using Zod's array methods.

```tsx showLineNumbers title="form.tsx"
const formSchema = z.object({
  emails: z
    .array(
      z.object({
        address: z.string().email("Enter a valid email address."),
      }),
    )
    .min(1, "Add at least one email address.")
    .max(5, "You can add up to 5 email addresses."),
});
```

