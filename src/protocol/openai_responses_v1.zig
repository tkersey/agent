const boundary = @import("boundary");

pub const semantic_identity = "agent.model.openai.responses.v1";

pub const TransportFailureKind = enum {
    unavailable,
    denied,
    interrupted,
    response_too_large,
};

pub fn Contract(
    comptime request_bytes: u32,
    comptime response_bytes: u32,
) type {
    if (request_bytes == 0) {
        @compileError("OpenAI Responses v1 request byte capacity must be positive");
    }
    if (response_bytes == 0) {
        @compileError("OpenAI Responses v1 response byte capacity must be positive");
    }

    return struct {
        pub const RequestBody = boundary.Bytes(request_bytes);
        pub const ResponseBody = boundary.Bytes(response_bytes);

        pub const Request = struct {
            body: RequestBody,
            maximum_response_bytes: u32,
        };

        pub const Response = union(enum) {
            response: struct {
                http_status: u16,
                body: ResponseBody,
            },
            transport_failure: struct {
                kind: TransportFailureKind,
            },
        };

        pub fn Site(comptime site_id: u32) type {
            return boundary.effect.site(
                site_id,
                semantic_identity,
                Request,
                Response,
            );
        }

        comptime {
            boundary.schema.assertPortable(Request);
            boundary.schema.assertPortable(Response);
        }
    };
}
