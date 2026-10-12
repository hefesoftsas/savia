import { BaseNodeRegistry } from "@savia/flows-runtime";
import { FormRequestNode } from "@savia/flows-runtime/nodes/form/form-request-node";
import { FormResponseNode } from "@savia/flows-runtime/nodes/form/form-response-node";
import { FormWebhookNode } from "@savia/flows-runtime/nodes/form/form-webhook-node";
import { NumberInputNode } from "@savia/flows-runtime/nodes/input/number-input-node";
import { ConditionalForkNode } from "@savia/flows-runtime/nodes/logic/conditional-fork-node";
import { ConditionalJoinNode } from "@savia/flows-runtime/nodes/logic/conditional-join-node";
import { CreateFeedbackFormNode } from "@savia/flows-runtime/nodes/logic/create-feedback-form-node";
import { CreateFormNode } from "@savia/flows-runtime/nodes/logic/create-form-node";
import { SwitchForkNode } from "@savia/flows-runtime/nodes/logic/switch-fork-node";
import { SwitchJoinNode } from "@savia/flows-runtime/nodes/logic/switch-join-node";
import { WaitForFormNode } from "@savia/flows-runtime/nodes/logic/wait-for-form-node";
import { AdditionNode } from "@savia/flows-runtime/nodes/math/addition-node";
import { AvgNode } from "@savia/flows-runtime/nodes/math/avg-node";
import { DivisionNode } from "@savia/flows-runtime/nodes/math/division-node";
import { MaxNode } from "@savia/flows-runtime/nodes/math/max-node";
import { MedianNode } from "@savia/flows-runtime/nodes/math/median-node";
import { MinNode } from "@savia/flows-runtime/nodes/math/min-node";
import { MultiplicationNode } from "@savia/flows-runtime/nodes/math/multiplication-node";
import { SubtractionNode } from "@savia/flows-runtime/nodes/math/subtraction-node";
import { SumNode } from "@savia/flows-runtime/nodes/math/sum-node";
// Imported from the module directly rather than the specification barrel: the
// barrel pulls in vitest, and these two nodes ship in the real registry.
import {
  FailingMultiStepNode,
  MultiStepAdditionNode,
} from "@savia/flows-runtime/specification/multi-step-test-nodes";
import type { Bindings } from "../context";

/**
 * Mock Node Registry
 *
 * Lightweight node registry for testing that only includes basic math operations
 * and logic nodes.
 * Uses real node implementations but provides a minimal subset to avoid loading
 * heavy dependencies (like geotiff).
 *
 * Includes:
 * - Addition, Subtraction, Multiplication, Division
 * - Number Input
 * - Sum, Max, Min, Avg, Median
 * - Conditional Fork, Conditional Join, Create Form, Wait for Form
 * - Multi-Step Addition, Failing Multi-Step (test nodes)
 */
export class MockNodeRegistry extends BaseNodeRegistry<Bindings> {
  protected registerNodes(): void {
    this.registerImplementation(AdditionNode);
    this.registerImplementation(SubtractionNode);
    this.registerImplementation(MultiplicationNode);
    this.registerImplementation(DivisionNode);
    this.registerImplementation(NumberInputNode);
    this.registerImplementation(SumNode);
    this.registerImplementation(MaxNode);
    this.registerImplementation(MinNode);
    this.registerImplementation(AvgNode);
    this.registerImplementation(MedianNode);
    this.registerImplementation(ConditionalForkNode);
    this.registerImplementation(ConditionalJoinNode);
    this.registerImplementation(SwitchForkNode);
    this.registerImplementation(SwitchJoinNode);
    this.registerImplementation(CreateFormNode);
    this.registerImplementation(CreateFeedbackFormNode);
    this.registerImplementation(WaitForFormNode);
    this.registerImplementation(FormRequestNode);
    this.registerImplementation(FormWebhookNode);
    this.registerImplementation(FormResponseNode);
    this.registerImplementation(MultiStepAdditionNode);
    this.registerImplementation(FailingMultiStepNode);
  }
}
