// Internal helper conveniences.

import Foundation

// Let String be used as the failure type of Result for compact internal APIs.
// (Helper-internal only; not exposed across module boundaries.)
extension String: @retroactive Error {}
