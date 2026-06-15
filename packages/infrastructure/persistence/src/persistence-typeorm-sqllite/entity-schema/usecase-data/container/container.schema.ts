/*
 * Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
 * SPDX-License-Identifier: BSD-3-Clause
 */

import {BaseColumnSchemaPart} from '../../entity-base.js';
import type {EntityBaseRow} from '../../entity-base.js';
import type {ArcDbFileRow} from '../../project-data/arc-db-file.schema.js';
import type {SpfModuleRow} from '../module/spf-module.schema.js';
import type {ContainerPropertyDataRow} from './container-property-data.js';
import type {ContainerTypeRow} from '../../definitions/container/container-definition.schema.js';
import {EntitySchema} from 'typeorm';

export interface ContainerRow extends EntityBaseRow {
  containerId: number;
  containerTypeSystemId: number;

  // inverse relation for convenience (reads)
  modules?: SpfModuleRow[];
  containerPropertyData?: ContainerPropertyDataRow[];
  containerType?: ContainerTypeRow;
  // scope to file
  fileSystemId: number;
  file?: ArcDbFileRow;
}

export const ContainerSchema = new EntitySchema<ContainerRow>({
  name: 'Container',
  tableName: 'containers',
  columns: {
    ...BaseColumnSchemaPart,
    containerId: {name: 'container_id', type: 'integer'},
    containerTypeSystemId: {
      name: 'container_type_system_id',
      type: 'integer',
      nullable: true,
    },
    fileSystemId: {name: 'file_system_id', type: 'integer'},
  },
  relations: {
    modules: {
      type: 'one-to-many',
      target: 'SpfModule',
      inverseSide: 'container',
    },
    containerPropertyData: {
      type: 'one-to-many',
      target: 'ContainerPropertyData',
      inverseSide: 'container',
    },
    containerType: {
      type: 'many-to-one',
      target: 'ContainerType',
      joinColumn: {
        name: 'container_type_system_id',
        referencedColumnName: 'systemId',
      },
      nullable: true,
    },
    file: {
      type: 'many-to-one',
      target: 'ArcDbFile',
      joinColumn: {name: 'file_system_id', referencedColumnName: 'systemId'},
      onDelete: 'CASCADE',
    },
  },
  indices: [
    {
      name: 'uq_containers_container_id_file_system_id',
      columns: ['containerId', 'fileSystemId'],
      unique: true,
    },
  ],
});
