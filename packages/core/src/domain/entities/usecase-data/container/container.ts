/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {ContainerPropertyValue} from './value-objects/container-property.js';

export class Container {
  public systemId: number;
  public containerId: number;
  public containerTypeSystemId: number | null;
  public fileSystemId: number;

  public properties: Map<number, ContainerPropertyValue>;

  constructor(
    systemId: number,
    containerId: number,
    containerTypeSystemId: number | null,
    fileSystemId: number,
  ) {
    this.systemId = systemId;
    this.containerId = containerId;
    this.containerTypeSystemId = containerTypeSystemId;
    this.fileSystemId = fileSystemId;

    this.properties = new Map<number, ContainerPropertyValue>();
  }
}
