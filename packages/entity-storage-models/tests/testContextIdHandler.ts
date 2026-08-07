// Copyright 2026 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IContextIdHandler } from "@twin.org/context";
import { GeneralError } from "@twin.org/core";
import { nameof } from "@twin.org/nameof";

/**
 * Minimal context ID handler for test use.
 * Short form: bare id stripped from a "did:example:<id>" value.
 * Long form: "did:internal:<id>" - a different DID method prefix, mirroring how
 * DidContextIdHandler uses "did:internal:" as its canonical long form.
 * guard() rejects any value that is not in long form, which lets migration tests
 * demonstrate the failure that occurs when getPartitionContextIds() returns
 * short-form values that have not been expanded back to long form.
 */
export class TestContextIdHandler implements IContextIdHandler {
	/**
	 * Runtime name for the class.
	 */
	public static readonly CLASS_NAME: string = nameof<TestContextIdHandler>();

	/**
	 * Prefix that identifies the short-form input to short().
	 */
	public static readonly EXAMPLE_PREFIX: string = "did:example:";

	/**
	 * Prefix used by long() and validated by guard().
	 */
	public static readonly INTERNAL_PREFIX: string = "did:internal:";

	/**
	 * The class name of the component.
	 * @returns The class name.
	 */
	public className(): string {
		return TestContextIdHandler.CLASS_NAME;
	}

	/**
	 * Get the short form by stripping the "did:example:" prefix.
	 * @param value The full context id value.
	 * @returns Short form string.
	 */
	public short(value: string): string {
		return value.startsWith(TestContextIdHandler.EXAMPLE_PREFIX)
			? value.slice(TestContextIdHandler.EXAMPLE_PREFIX.length)
			: value;
	}

	/**
	 * Reconstruct the long form by prepending the "did:internal:" prefix.
	 * @param value The short form context ID value.
	 * @returns The long form version of the context ID.
	 */
	public long(value: string): string {
		return value.startsWith(TestContextIdHandler.INTERNAL_PREFIX)
			? value
			: `${TestContextIdHandler.INTERNAL_PREFIX}${value}`;
	}

	/**
	 * Guard the value, ensuring it is in long form with the "did:internal:" prefix.
	 * @param value The value to guard.
	 * @throws GeneralError if the value is not a valid long-form context ID.
	 */
	public guard(value: string): void {
		if (!value.startsWith(TestContextIdHandler.INTERNAL_PREFIX)) {
			throw new GeneralError(TestContextIdHandler.CLASS_NAME, "invalidContextId", { value });
		}
	}
}
