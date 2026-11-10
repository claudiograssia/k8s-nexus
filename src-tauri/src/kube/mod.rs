//! Kubernetes integration layer: config parsing, client pool, generic resource
//! operations, metrics, log streaming and port-forwarding.

pub mod access;
pub mod client;
pub mod config;
pub mod logs;
pub mod metrics;
pub mod ops;
pub mod portforward;
pub mod resources;
pub mod watch;
