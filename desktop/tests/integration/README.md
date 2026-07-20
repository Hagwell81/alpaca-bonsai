# Integration Tests

Integration tests verify the real behavior of Phase 1 components against actual `llama-server` instances.

## Running Integration Tests

### Prerequisites

- `llama-server` binary available on your system
- A GGUF model file for testing

### Test: slot-start-real-binary.test.js

**Purpose:** Verifies the real slot lifecycle (idle → starting → running → stopping → idle) against an actual llama-server instance.

**Requirements Covered:**
- Requirement 2: Slot Lifecycle State Machine
- Requirement 14.1: Chat-Template Tool-Calling Detection

**How to Run:**

```bash
# Set LLAMA_BIN to the path of your llama-server binary
export LLAMA_BIN=/path/to/llama-server

# Run the test
npm test -- desktop/tests/integration/slot-start-real-binary.test.js --timeout 120000
```

Or on Windows:

```powershell
$env:LLAMA_BIN = "C:\path\to\llama-server.exe"
npm test -- desktop/tests/integration/slot-start-real-binary.test.js --timeout 120000
```

**What It Tests:**

1. **Slot Lifecycle Transitions:** Verifies that a slot transitions through the legal state sequence:
   - idle → starting → running → stopping → idle
   - All transitions are legal per the state machine definition
   - Events are emitted for each transition

2. **Port and PID Uniqueness:** Ensures that:
   - No two running slots share the same port
   - No two running slots share the same process ID
   - This is verified both during single-slot and multi-slot scenarios

3. **Chat Template Detection:** Verifies that:
   - After a slot reaches `running`, the `supportsTools` field is populated
   - The `chatTemplate` field is populated from the `/props` endpoint
   - Both fields are properly typed (boolean and string respectively)

4. **Event Timestamps:** Ensures that:
   - All `slot-status-changed` events include an ISO-8601 timestamp in the `at` field
   - Timestamps are valid and parseable

5. **Multi-Slot Isolation:** Verifies that:
   - Multiple slots can run concurrently
   - Each slot maintains its own state
   - Port and PID uniqueness is maintained across multiple slots

**Test Behavior:**

- If `LLAMA_BIN` is not set, the test is skipped
- If the llama-server binary is not found, the test is skipped
- If no GGUF model is found in common locations, the test is skipped
- The test automatically searches for a model in:
  - `~/.cache/huggingface/hub`
  - `~/models`
  - `/tmp/models`
  - `C:\models`

**Timeout:** 120 seconds (2 minutes) to allow for real binary startup and health probing

### Test: cuda-visible-devices-real-spawn.test.js

**Purpose:** Verifies that CUDA_VISIBLE_DEVICES environment variable is correctly set when spawning real child processes.

**Requirements Covered:**
- Requirement 5.2: CUDA_VISIBLE_DEVICES formatting (dedup, sort, comma-join)
- Requirement 5.3: CUDA_VISIBLE_DEVICES omission when visibleDevices is empty
- Requirement 5.6: Environment variable is read only at spawn time

**How to Run:**

```bash
# Set LLAMA_BIN to the path of your llama-server binary
export LLAMA_BIN=/path/to/llama-server

# Run the test
npm test -- desktop/tests/integration/cuda-visible-devices-real-spawn.test.js --timeout 120000
```

Or on Windows:

```powershell
$env:LLAMA_BIN = "C:\path\to\llama-server.exe"
npm test -- desktop/tests/integration/cuda-visible-devices-real-spawn.test.js --timeout 120000
```

**What It Tests:**

1. **CUDA_VISIBLE_DEVICES Setting:** Verifies that:
   - Starting a slot with non-empty `visibleDevices` successfully spawns a child process
   - The child process is spawned with the correct environment (deduped, sorted, comma-joined)
   - The slot reaches `running` state with the environment set

2. **Environment Immutability:** Verifies that:
   - Changing `visibleDevices` while a slot is running does NOT mutate the running child's environment
   - The process continues running with the original environment
   - The PID remains unchanged

3. **New Value on Restart:** Verifies that:
   - After stopping a slot, the next `startSlot` picks up the new `visibleDevices` value
   - A new process is spawned (different PID)
   - The new process has the updated environment

4. **Empty visibleDevices Handling:** Verifies that:
   - When `visibleDevices` is empty, CUDA_VISIBLE_DEVICES is NOT set in the child env
   - The child inherits CUDA_VISIBLE_DEVICES from `process.env` if it was already set
   - The slot starts successfully in both cases

5. **Multi-Slot GPU Pinning:** Verifies that:
   - Multiple slots can run with different `visibleDevices` values
   - Each slot is spawned with its own CUDA_VISIBLE_DEVICES value
   - Both slots run successfully with different GPU assignments

**Test Behavior:**

- If `LLAMA_BIN` is not set, the test is skipped
- If the llama-server binary is not found, the test is skipped
- If no GGUF model is found in common locations, the test is skipped
- The test automatically searches for a model in the same locations as other integration tests

**Timeout:** 120 seconds (2 minutes) to allow for real binary startup and health probing

## Notes

- Integration tests require a real `llama-server` binary and model, making them slower than unit tests
- These tests are gated behind environment variables to allow CI/CD pipelines to skip them when the binary is not available
- The test uses a 60-second timeout for slot startup to account for model loading time
- After each test, all slots are stopped to clean up resources
