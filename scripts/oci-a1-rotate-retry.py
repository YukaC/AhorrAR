#!/home/yuka/.local/share/uv/tools/oci-cli/bin/python
"""Retry Always Free A1 until host capacity. Uses OCI Python SDK (CLI hangs)."""
from __future__ import annotations

import os
import sys
import time
from datetime import datetime, timezone

import oci
from oci.core.models import (
    CreateVnicDetails,
    InstanceSourceViaImageDetails,
    LaunchInstanceDetails,
    LaunchInstanceShapeConfigDetails,
)

TENANCY = os.environ.get(
    "TENANCY_OCID",
    "ocid1.tenancy.oc1..aaaaaaaaydgugky4w2iiurlm4ntqj2wt7lbnlxejbklytfjpsiy577yz3raq",
)
SUBNET = os.environ.get(
    "SUBNET",
    "ocid1.subnet.oc1.sa-saopaulo-1.aaaaaaaa5geivwfeer6gl7qvyial72ysi5smtlcooqg7jcr5wvkcgu7toada",
)
AD = os.environ.get("AD", "TgJG:SA-SAOPAULO-1-AD-1")
SSH_PUB = os.environ.get("SSH_PUB", os.path.expanduser("~/.ssh/oci_ahorrar.pub"))
LOG = os.environ.get("LOG", "/tmp/oci-vm-a-retry.log")
SLEEP_S = int(os.environ.get("SLEEP_S", "45"))
DISPLAY_NAME = os.environ.get("DISPLAY_NAME", "ahorrar-api")

IMAGES = [
    "ocid1.image.oc1.sa-saopaulo-1.aaaaaaaawkokpnrdloctuiwulydrjsqvok5yy5ockwtrmsqswlm57ncbd56q",
    "ocid1.image.oc1.sa-saopaulo-1.aaaaaaaaj6y3wvj5ku4ahs4isf4aif5cz5yif7repspank6oghq4dnjprdia",
    "ocid1.image.oc1.sa-saopaulo-1.aaaaaaaacsccoglc53hnew4kabqluihun3y3zwchidu2gutjavvk7bvolyqa",
]
FAULT_DOMAINS: list[str | None] = [None, "FAULT-DOMAIN-1", "FAULT-DOMAIN-2", "FAULT-DOMAIN-3"]


def log(msg: str) -> None:
    line = f"{msg}"
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def main() -> int:
    with open(SSH_PUB, encoding="utf-8") as fh:
        ssh_key = fh.read().strip()

    cfg = oci.config.from_file()
    # Prefer home region for Always Free A1
    cfg["region"] = os.environ.get("OCI_REGION", cfg.get("region", "sa-saopaulo-1"))
    client = oci.core.ComputeClient(
        cfg,
        timeout=(10, 30),
        retry_strategy=oci.retry.NoneRetryStrategy(),
    )

    log(f"=== rotate-retry-py {now()} pid={os.getpid()} sleep={SLEEP_S}s ===")
    attempt = 0
    while True:
        attempt += 1
        image_id = IMAGES[(attempt - 1) % len(IMAGES)]
        fault_domain = FAULT_DOMAINS[(attempt - 1) % len(FAULT_DOMAINS)]
        fd_label = fault_domain or "auto"
        log(f"capacity try {attempt} {now()} img={image_id[-8:]} fd={fd_label}")

        details = LaunchInstanceDetails(
            availability_domain=AD,
            compartment_id=TENANCY,
            display_name=DISPLAY_NAME,
            shape="VM.Standard.A1.Flex",
            shape_config=LaunchInstanceShapeConfigDetails(ocpus=1.0, memory_in_gbs=6.0),
            create_vnic_details=CreateVnicDetails(subnet_id=SUBNET, assign_public_ip=True),
            source_details=InstanceSourceViaImageDetails(
                source_type="image",
                image_id=image_id,
                boot_volume_size_in_gbs=50,
            ),
            metadata={"ssh_authorized_keys": ssh_key},
            fault_domain=fault_domain,
        )

        try:
            resp = client.launch_instance(details)
            instance_id = resp.data.id
            log(f"Launched {instance_id}")
            for _ in range(90):
                st = client.get_instance(instance_id).data.lifecycle_state
                log(f"lifecycle={st}")
                if st == "RUNNING":
                    break
                time.sleep(8)
            vnics = client.list_vnic_attachments(
                compartment_id=TENANCY, instance_id=instance_id
            ).data
            public_ip = ""
            if vnics:
                vnic = oci.core.VirtualNetworkClient(cfg).get_vnic(vnics[0].vnic_id).data
                public_ip = vnic.public_ip or ""
            log(f"instance_ocid={instance_id}")
            log(f"public_ip={public_ip}")
            return 0
        except oci.exceptions.ServiceError as exc:
            msg = exc.message or str(exc)
            code = exc.code or "?"
            log(f"miss (attempt {attempt}) fd={fd_label} code={code} msg={msg}")
        except Exception as exc:  # noqa: BLE001 — keep loop alive
            log(f"error (attempt {attempt}) fd={fd_label} {type(exc).__name__}: {exc}")

        time.sleep(SLEEP_S)


if __name__ == "__main__":
    sys.exit(main())
