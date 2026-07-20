# Property-Based Testing Best Practices Guide

## Introduction

This guide provides best practices for writing and maintaining property-based tests in the Alpaca project. These practices ensure that property tests are effective, maintainable, and provide maximum value.

## 1. Defining Properties

### 1.1 Properties Should Be Universal

A property should hold true for **all valid inputs**, not just specific examples.

❌ **Bad:**
```javascript
// Only tests specific values
it('should encrypt and decrypt', async () => {
  const secret = 'my-secret';
  const encrypted = encrypt(secret);
  const decrypted = decrypt(encrypted);
  assert.strictEqual(decrypted, secret);
});
```

✅ **Good:**
```javascript
// Tests all strings
fc.assert(
  fc.asyncProperty(
    fc.string(),
    async (secret) => {
      const encrypted = encrypt(secret);
      const decrypted = decrypt(encrypted);
      assert.strictEqual(decrypted, secret);
    }
  ),
  { numRuns: 150 }
);
```

### 1.2 Properties Should Be Invariants

Properties should express invariants that must always hold, not specific behaviors.

❌ **Bad:**
```javascript
// Tests specific behavior
fc.assert(
  fc.asyncProperty(
    fc.string(),
    async (secret) => {
      const encrypted = encrypt(secret);
      // Assumes specific encryption format
      assert(encrypted.startsWith('enc_'));
    }
  )
);
```

✅ **Good:**
```javascript
// Tests invariant
fc.assert(
  fc.asyncProperty(
    fc.string(),
    async (secret) => {
      const encrypted = encrypt(secret);
      const decrypted = decrypt(encrypted);
      // Invariant: decryption reverses encryption
      assert.strictEqual(decrypted, secret);
    }
  )
);
```

### 1.3 Properties Should Be Testable

Properties must be verifiable through assertions or checks.

❌ **Bad:**
```javascript
// Not testable - no assertion
fc.assert(
  fc.asyncProperty(
    fc.string(),
    async (secret) => {
      const encrypted = encrypt(secret);
      // No verification
    }
  )
);
```

✅ **Good:**
```javascript
// Testable - clear assertion
fc.assert(
  fc.asyncProperty(
    fc.string(),
    async (secret) => {
      const encrypted = encrypt(secret);
      const decrypted = decrypt(encrypted);
      assert.strictEqual(decrypted, secret);
    }
  )
);
```

## 2. Choosing Generators

### 2.1 Match Generators to Input Space

Use generators that match the actual input space of the function.

❌ **Bad:**
```javascript
// Function expects non-empty strings
fc.assert(
  fc.asyncProperty(
    fc.string(),  // Could be empty
    async (key) => {
      const result = getSecret(key);
      // Fails on empty key
    }
  )
);
```

✅ **Good:**
```javascript
// Generator matches input constraints
fc.assert(
  fc.asyncProperty(
    fc.string({ minLength: 1, maxLength: 256 }),
    async (key) => {
      const result = getSecret(key);
      assert(result !== undefined);
    }
  )
);
```

### 2.2 Use Constrained Generators

Constrain generators to realistic values to avoid false failures.

❌ **Bad:**
```javascript
// Generates unrealistic file sizes
fc.assert(
  fc.asyncProperty(
    fc.integer(),  // Could be negative or huge
    async (fileSize) => {
      const file = createFile(fileSize);
      assert(file.size === fileSize);
    }
  )
);
```

✅ **Good:**
```javascript
// Realistic file sizes
fc.assert(
  fc.asyncProperty(
    fc.integer({ min: 0, max: 100000000 }),  // 0 - 100MB
    async (fileSize) => {
      const file = createFile(fileSize);
      assert(file.size === fileSize);
    }
  )
);
```

### 2.3 Combine Generators for Complex Inputs

Use tuple generators for multiple inputs.

❌ **Bad:**
```javascript
// Separate generators - could be inconsistent
fc.assert(
  fc.asyncProperty(
    fc.string(),
    fc.integer(),
    async (name, age) => {
      // name and age are independent
    }
  )
);
```

✅ **Good:**
```javascript
// Combined generator - consistent inputs
fc.assert(
  fc.asyncProperty(
    fc.tuple(
      fc.string({ minLength: 1, maxLength: 100 }),
      fc.integer({ min: 0, max: 150 })
    ),
    async ([name, age]) => {
      // name and age are related
    }
  )
);
```

## 3. Test Organization

### 3.1 Group Related Properties

Organize properties by component or feature.

```javascript
describe('Property 4.2.1: Encryption Round-Trip', function() {
  this.timeout(30000);

  it('should satisfy decrypt(encrypt(secret)) == secret for 100+ random secrets', async () => {
    // Test 1
  });

  it('should handle empty strings in encryption round-trip', async () => {
    // Test 2
  });

  it('should handle very long secrets (up to 1MB)', async () => {
    // Test 3
  });
});
```

### 3.2 Use Descriptive Test Names

Test names should clearly describe the property being tested.

❌ **Bad:**
```javascript
it('test 1', async () => { ... });
it('encryption test', async () => { ... });
```

✅ **Good:**
```javascript
it('should satisfy decrypt(encrypt(secret)) == secret for 100+ random secrets', async () => { ... });
it('should handle empty strings in encryption round-trip', async () => { ... });
```

### 3.3 Document Edge Cases

Include comments explaining edge cases being tested.

```javascript
it('should handle empty strings in encryption round-trip', async () => {
  // Edge case: empty string should encrypt and decrypt correctly
  // This tests boundary condition where secret has zero length
  const store = createMockStore();
  const vault = new SecretVault(store, createMockKeyDerivation());
  await vault.initialize();

  await vault.setSecret('empty_secret', '');
  const decrypted = await vault.getSecret('empty_secret');
  assert.strictEqual(decrypted, '');
});
```

## 4. Handling Failures

### 4.1 Understand Shrinking

When a property fails, fast-check shrinks the failing example to find the minimal case.

```
Counterexample: secret = "test\n"
Shrunk to: secret = "\n"
```

This helps identify the root cause.

### 4.2 Reproduce Failures

Use seeds to reproduce failures consistently.

```javascript
// Reproduce specific failure
fc.assert(
  fc.asyncProperty(...),
  { seed: 12345 }
);
```

### 4.3 Fix Root Causes

When a property fails, fix the root cause, not just the specific case.

❌ **Bad:**
```javascript
// Only handles the specific failing case
if (secret === '\n') {
  return secret;
}
```

✅ **Good:**
```javascript
// Fixes the root cause for all cases
const trimmed = secret.trim();
return trimmed;
```

## 5. Performance Optimization

### 5.1 Adjust Number of Runs

Balance thoroughness with execution time.

```javascript
// Quick smoke test
{ numRuns: 50 }

// Standard testing
{ numRuns: 150 }

// Thorough testing
{ numRuns: 500 }
```

### 5.2 Use Appropriate Timeouts

Set timeouts based on test complexity.

```javascript
describe('Property Tests', function() {
  this.timeout(30000);  // 30 seconds for all tests
  
  it('fast test', async () => { ... });
  it('slow test', async () => { ... });
});
```

### 5.3 Parallelize Independent Tests

Run independent properties in parallel.

```bash
# Run multiple test files in parallel
npm test -- tests/phase-4-properties.test.js tests/other-properties.test.js
```

## 6. Maintenance

### 6.1 Keep Properties Stable

Avoid changing properties frequently - they should be stable invariants.

❌ **Bad:**
```javascript
// Property changes with implementation
// This is not a stable invariant
fc.assert(
  fc.asyncProperty(
    fc.string(),
    async (secret) => {
      const encrypted = encrypt(secret);
      // Assumes specific encryption algorithm
      assert(encrypted.includes('aes-256'));
    }
  )
);
```

✅ **Good:**
```javascript
// Property is stable regardless of implementation
fc.assert(
  fc.asyncProperty(
    fc.string(),
    async (secret) => {
      const encrypted = encrypt(secret);
      const decrypted = decrypt(encrypted);
      // Invariant: decryption reverses encryption
      assert.strictEqual(decrypted, secret);
    }
  )
);
```

### 6.2 Update Generators When Requirements Change

When input constraints change, update generators accordingly.

```javascript
// Before: keys up to 256 characters
fc.string({ minLength: 1, maxLength: 256 })

// After: keys up to 512 characters
fc.string({ minLength: 1, maxLength: 512 })
```

### 6.3 Document Property Changes

When modifying properties, document the reason.

```javascript
// Updated to test larger file sizes (Requirement 7.2)
fc.integer({ min: 0, max: 1000000000 })  // 0 - 1GB
```

## 7. Integration with CI/CD

### 7.1 Run Properties in CI

Include property tests in continuous integration.

```yaml
# .github/workflows/test.yml
- name: Run property tests
  run: npm test -- tests/phase-4-properties.test.js
```

### 7.2 Set Minimum Coverage

Require minimum test coverage.

```javascript
// Ensure at least 150 runs per property
{ numRuns: 150 }
```

### 7.3 Monitor Performance

Track test execution time to detect regressions.

```bash
# Measure test execution time
time npm test -- tests/phase-4-properties.test.js
```

## 8. Common Pitfalls

### 8.1 Non-Deterministic Code

❌ **Bad:**
```javascript
fc.assert(
  fc.asyncProperty(
    fc.string(),
    async (secret) => {
      const timestamp = Date.now();  // Non-deterministic
      const encrypted = encrypt(secret, timestamp);
      const decrypted = decrypt(encrypted, timestamp);
      assert.strictEqual(decrypted, secret);
    }
  )
);
```

✅ **Good:**
```javascript
fc.assert(
  fc.asyncProperty(
    fc.tuple(
      fc.string(),
      fc.integer()
    ),
    async ([secret, seed]) => {
      const encrypted = encrypt(secret, seed);
      const decrypted = decrypt(encrypted, seed);
      assert.strictEqual(decrypted, secret);
    }
  )
);
```

### 8.2 Side Effects

❌ **Bad:**
```javascript
fc.assert(
  fc.asyncProperty(
    fc.string(),
    async (secret) => {
      // Side effect: modifies global state
      global.lastSecret = secret;
      const encrypted = encrypt(secret);
      const decrypted = decrypt(encrypted);
      assert.strictEqual(decrypted, secret);
    }
  )
);
```

✅ **Good:**
```javascript
fc.assert(
  fc.asyncProperty(
    fc.string(),
    async (secret) => {
      // No side effects
      const encrypted = encrypt(secret);
      const decrypted = decrypt(encrypted);
      assert.strictEqual(decrypted, secret);
    }
  )
);
```

### 8.3 Overly Complex Properties

❌ **Bad:**
```javascript
fc.assert(
  fc.asyncProperty(
    fc.string(),
    async (secret) => {
      // Too many assertions
      const encrypted = encrypt(secret);
      assert(encrypted.length > 0);
      assert(encrypted !== secret);
      const decrypted = decrypt(encrypted);
      assert.strictEqual(decrypted, secret);
      const hash = sha256(encrypted);
      assert(hash.length === 64);
      // ... more assertions
    }
  )
);
```

✅ **Good:**
```javascript
// Separate properties for each invariant
fc.assert(
  fc.asyncProperty(
    fc.string(),
    async (secret) => {
      const encrypted = encrypt(secret);
      const decrypted = decrypt(encrypted);
      assert.strictEqual(decrypted, secret);
    }
  )
);
```

## 9. Metrics and Reporting

### 9.1 Track Test Coverage

Monitor which properties are being tested.

```
Property 4.2.1: Encryption Round-Trip ✅ 150 cases
Property 4.2.2: SHA-256 Verification ✅ 150 cases
Property 4.2.3: Vision Pairing ✅ 150 cases
Property 4.2.4: Warm-Cache Performance ✅ 150 cases
Property 4.2.5: Request Batching ✅ 150 cases
Property 4.2.6: Connection Pool ✅ 150 cases
Property 4.2.7: Key Derivation ✅ 150 cases
Property 4.2.8: Tampering Detection ✅ 150 cases
Total: 1200+ test cases
```

### 9.2 Report Execution Time

Track test performance over time.

```
Test Execution Time:
- 2026-05-08: 3.2s
- 2026-05-09: 3.1s
- 2026-05-10: 3.3s
Average: 3.2s
```

### 9.3 Document Findings

Record important findings from property tests.

```markdown
## Property Test Findings

### 4.2.1: Encryption Round-Trip
- ✅ All secret types handled correctly
- ✅ No data loss or corruption
- ✅ Unicode characters preserved

### 4.2.2: SHA-256 Verification
- ✅ Single-bit tampering detected
- ✅ Hash consistency verified
- ✅ Empty files handled correctly
```

## 10. Conclusion

Property-based testing is a powerful technique for verifying software correctness. By following these best practices, you can write effective, maintainable property tests that provide high confidence in your code.

### Key Takeaways

1. **Define universal properties** that hold for all valid inputs
2. **Choose appropriate generators** that match input constraints
3. **Keep properties simple** and focused on single invariants
4. **Organize tests** by component or feature
5. **Handle failures** by fixing root causes
6. **Maintain properties** as stable invariants
7. **Integrate with CI/CD** for continuous validation
8. **Avoid common pitfalls** like non-determinism and side effects
9. **Track metrics** to monitor test effectiveness
10. **Document findings** for future reference

---

**Framework:** fast-check
**Test File:** `desktop/tests/phase-4-properties.test.js`
**Status:** ✅ COMPLETE
